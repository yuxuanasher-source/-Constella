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
    name: "周风险复盘",
    description: "只读汇总项目风险与缺失数据",
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

  it("lets an owner inspect hash and manifest, then approve or reject with a human action", async () => {
    render(
      <HermesSkillDraftReview
        draft={draft}
        currentUser={{ id: "owner-1", role: "owner" }}
      />,
    );

    expect(screen.getByText("Skill 草稿审核")).toBeInTheDocument();
    expect(screen.getByText("weekly-risk-brief")).toBeInTheDocument();
    expect(
      screen.getByText("sha256:9d7f4c7a5b6e8f901234567890abcdef"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Hermes Gateway|provider|model/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 manifest" }));

    expect(screen.getByText('"name": "周风险复盘"')).toBeInTheDocument();
    expect(screen.getByText('"read:projects"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "批准" }));
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

    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        "/api/ai/hermes/skill-drafts/skill-draft-1/review",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"decision":"reject"'),
        }),
      ),
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      decision: "reject",
      humanAction: true,
    });
  });

  it("hides approval commands from non-owners", () => {
    render(
      <HermesSkillDraftReview
        draft={draft}
        currentUser={{ id: "staff-1", role: "ops" }}
      />,
    );

    expect(screen.getByText("weekly-risk-brief")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
  });
});
