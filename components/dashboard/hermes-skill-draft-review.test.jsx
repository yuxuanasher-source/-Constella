import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HermesSkillDraftReview } from "./hermes-skill-draft-review";

const draft = {
  id: "skill-draft-1",
  skillId: "weekly-risk-brief",
  version: "0.1.0",
  bundleSha256: "sha256:9d7f4c7a5b6e8f901234567890abcdef",
  manifest: {
    name: "Weekly risk brief",
    description: "Read-only project risk and missing-data summary",
    permissions: ["read:projects", "read:settlements"],
  },
  status: "pending_review",
};

describe("HermesSkillDraftReview", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              draft: { ...draft, status: "approved" },
            }),
        }),
      ),
    );
  });

  it("lets an owner inspect hash and manifest, then records one human decision", async () => {
    render(
      <HermesSkillDraftReview
        draft={draft}
        currentUser={{ id: "owner-1", role: "owner" }}
      />,
    );

    expect(screen.getByText("weekly-risk-brief")).toBeInTheDocument();
    expect(
      screen.getByText("sha256:9d7f4c7a5b6e8f901234567890abcdef"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Hermes Gateway|provider|model/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /manifest/i }));

    expect(screen.getByText('"name": "Weekly risk brief"')).toBeInTheDocument();
    expect(screen.getByText('"read:projects"')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("skill-draft-approve"));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/ai/hermes/skill-drafts/skill-draft-1/review",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"decision":"approve"'),
        }),
      ),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      decision: "approve",
      humanAction: true,
    });
    expect(screen.getByTestId("skill-draft-approve")).toBeDisabled();
    expect(screen.getByTestId("skill-draft-reject")).toBeDisabled();

    fireEvent.click(screen.getByTestId("skill-draft-reject"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps owner commands available after a safe review failure", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({ error: "Hermes Gateway provider stack trace" }),
    });
    render(
      <HermesSkillDraftReview
        draft={draft}
        currentUser={{ id: "owner-1", role: "owner" }}
      />,
    );

    fireEvent.click(screen.getByTestId("skill-draft-approve"));

    expect(await screen.findByTestId("skill-draft-review-error")).toHaveTextContent(
      "审核提交失败",
    );
    expect(screen.getByTestId("skill-draft-approve")).toBeEnabled();
    expect(screen.getByTestId("skill-draft-reject")).toBeEnabled();
    expect(
      screen.queryByText(/Hermes Gateway|provider|stack/i),
    ).not.toBeInTheDocument();
  });

  it("hides approval commands from non-owners", () => {
    render(
      <HermesSkillDraftReview
        draft={draft}
        currentUser={{ id: "staff-1", role: "ops" }}
      />,
    );

    expect(screen.getByText("weekly-risk-brief")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-draft-approve")).not.toBeInTheDocument();
    expect(screen.queryByTestId("skill-draft-reject")).not.toBeInTheDocument();
  });

  it("redacts unsafe draft fields before rendering them", () => {
    const unsafeDraft = {
      ...draft,
      id: "unsafe-draft",
      skillId: "Hermes Gateway /api/internal skill provider model",
      bundleSha256: "sha256:{\"args\":true}",
      version: "event: provider data: stack",
      status: "provider model stack at /api/internal",
      manifest: {
        name: "Hermes Gateway tool",
        prompt: "private chain-of-thought",
        sessionId: "session-secret",
        route: "/api/internal/hermes",
        safeName: "Weekly risk brief",
        nested: { data: "event: provider stack" },
      },
    };
    const { container } = render(
      <HermesSkillDraftReview
        draft={unsafeDraft}
        currentUser={{ id: "owner-1", role: "owner" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /manifest/i }));

    expect(screen.getAllByText("已隐藏内部字段").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('"safeName": "Weekly risk brief"')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(
      /Hermes Gateway|provider|model|\/api\/internal|stack|args|prompt|sessionId|event:|data:|chain-of-thought/i,
    );
  });
});
