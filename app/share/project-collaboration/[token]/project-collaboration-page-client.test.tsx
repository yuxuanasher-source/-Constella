import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectCollaborationPageClient from "./project-collaboration-page-client";

const collaboration = {
  available: true,
  share: {
    status: "active",
    expiresAt: "2026-06-24T00:00:00.000Z",
    allowApplications: true,
  },
  project: {
    id: "project-1",
    name: "Owner project",
    code: "COLLAB",
    ownerOrganizationName: "Owner Org",
    collaborationSummary: "Partner MCNs can contribute verified streamers.",
    collaborationTerms: { revenueShareHint: "8-12%" },
    privateMargin: 0.4,
  },
};

describe("ProjectCollaborationPageClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (
          String(url) === "/api/public/project-collaboration/plain-token" &&
          init?.method === "GET"
        ) {
          return {
            ok: true,
            json: async () => ({ collaboration }),
          };
        }

        if (
          String(url) === "/api/public/project-collaboration/plain-token" &&
          init?.method === "POST"
        ) {
          return {
            ok: true,
            json: async () => ({
              application: {
                id: "application-1",
                status: "submitted",
              },
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

  it("loads the public collaboration page without rendering private fields", async () => {
    const { container } = render(
      <ProjectCollaborationPageClient token="plain-token" />,
    );

    expect(await screen.findByText("Owner project")).toBeInTheDocument();
    expect(screen.getByText("Owner Org")).toBeInTheDocument();
    expect(
      screen.getByText("Partner MCNs can contribute verified streamers."),
    ).toBeInTheDocument();
    expect(screen.getByText("8-12%")).toBeInTheDocument();
    expect(container.textContent).not.toContain("tokenHash");
    expect(container.textContent).not.toContain("privateMargin");
    expect(container.textContent).not.toContain("share-1");
  });

  it("submits a requested revenue share as basis points", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(<ProjectCollaborationPageClient token="plain-token" />);

    await screen.findByText("Owner project");
    fireEvent.change(screen.getByLabelText("Revenue share %"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Application note"), {
      target: { value: "We can bring five verified streamers." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/project-collaboration/plain-token",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/public/project-collaboration/plain-token" &&
        init?.method === "POST",
    );
    expect(JSON.parse(String(submitCall?.[1]?.body))).toEqual({
      requestedRevenueShareBps: 1000,
      applicantNote: "We can bring five verified streamers.",
    });
    expect(
      await screen.findByText("Application submitted"),
    ).toBeInTheDocument();
  });
});
