import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdmissionSharePageClient from "./admission-share-page-client";

const shareBoard = {
  id: "share-1",
  title: "Vendor review",
  status: "active",
  expiresAt: "2026-06-14T00:00:00.000Z",
  allowVendorSubmit: true,
  project: {
    id: "project-1",
    code: "P-001",
    name: "Alpha Project",
    vendor: "Vendor A",
    product: "Game A",
  },
  items: [
    {
      applicationId: "app-1",
      applicationStatus: "recording_reviewing",
      recordingSubmissionId: "rec-1",
      recordingVersion: 2,
      recordingStatus: "reviewing",
      recordingUrl: "https://video.example/rec-1",
      hasPrivateStorage: false,
      streamer: {
        id: "streamer-1",
        displayName: "Streamer One",
        accountLabel: "Douyin / one-live",
      },
      vendorReview: null,
    },
    {
      applicationId: "app-2",
      applicationStatus: "joined",
      recordingSubmissionId: "rec-2",
      recordingVersion: 1,
      recordingStatus: "approved",
      recordingUrl: null,
      hasPrivateStorage: true,
      streamer: {
        id: "streamer-2",
        displayName: "Streamer Two",
        accountLabel: "Bilibili / two-live",
      },
      vendorReview: {
        decision: "backup",
        remark: "Can be backup.",
        reviewerName: "Vendor Reviewer",
        reviewerContact: "reviewer@example.com",
        submittedAt: "2026-06-07T04:00:00.000Z",
      },
    },
  ],
};

describe("AdmissionSharePageClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (
          String(url) ===
            "/api/public/admission-share/plain-token?accessCode=2468" &&
          init?.method === "GET"
        ) {
          return {
            ok: true,
            json: async () => ({ shareBoard }),
          };
        }

        if (
          String(url) ===
            "/api/public/admission-share/plain-token/reviews?accessCode=2468" &&
          init?.method === "POST"
        ) {
          return {
            ok: true,
            json: async () => ({
              submittedCount: 2,
              syncedCount: 1,
              skippedCount: 1,
            }),
          };
        }

        return {
          ok: false,
          json: async () => ({ error: "unexpected request" }),
        };
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the public share board without rendering token hashes or storage paths", async () => {
    const { container } = render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Vendor A / Game A")).toBeInTheDocument();
    expect(screen.getByText("Streamer One")).toBeInTheDocument();
    expect(screen.getByText("Douyin / one-live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看录屏" })).toHaveAttribute(
      "href",
      "https://video.example/rec-1",
    );
    expect(screen.getByText("Can be backup.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("tokenHash");
    expect(container.textContent).not.toContain("storagePath");
    expect(container.textContent).not.toContain("private/path");
  });

  it("submits reviewer decisions with locked recording versions", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    await screen.findByText("Alpha Project");
    fireEvent.change(screen.getByLabelText("复核人姓名"), {
      target: { value: "Vendor Reviewer" },
    });
    fireEvent.change(screen.getByLabelText("联系方式"), {
      target: { value: "reviewer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Streamer One 决策"), {
      target: { value: "selected" },
    });
    fireEvent.change(screen.getByLabelText("Streamer One 备注"), {
      target: { value: "Good fit." },
    });

    fireEvent.click(screen.getByRole("button", { name: "提交复核" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/admission-share/plain-token/reviews?accessCode=2468",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/reviews") && init?.method === "POST",
    );
    expect(JSON.parse(String(submitCall?.[1]?.body))).toEqual({
      reviewerName: "Vendor Reviewer",
      reviewerContact: "reviewer@example.com",
      items: [
        {
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          decision: "selected",
          remark: "Good fit.",
          reasonCodes: [],
        },
        {
          recordingSubmissionId: "rec-2",
          recordingVersion: 1,
          decision: "backup",
          remark: "Can be backup.",
          reasonCodes: [],
        },
      ],
    });
    expect(
      await screen.findByText("提交成功：2 条反馈，1 条已同步，1 条仅记录"),
    ).toBeInTheDocument();
  });

  it("requires remarks before submitting vendor rejection decisions", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    await screen.findByText("Alpha Project");
    fireEvent.change(screen.getByLabelText("Streamer One 决策"), {
      target: { value: "rejected" },
    });

    fireEvent.click(screen.getByRole("button", { name: "提交复核" }));

    expect(
      await screen.findByText("拒绝或需修改时请填写原因"),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/reviews") && init?.method === "POST",
      ),
    ).toBe(false);
  });
});
