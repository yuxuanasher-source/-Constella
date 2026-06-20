import { describe, expect, it, vi } from "vitest";

import { isActivated, markOnboardingStep } from "./onboarding";

describe("isActivated", () => {
  it("activates when required steps plus one engagement step are complete", () => {
    expect(isActivated(["create_project", "add_streamer", "schedule_live"])).toBe(
      true,
    );
    expect(isActivated(["create_project", "add_streamer", "submit_report"])).toBe(
      true,
    );
  });

  it("is not activated without the required steps or an engagement step", () => {
    expect(isActivated(["create_project", "add_streamer"])).toBe(false);
    expect(isActivated(["create_project", "submit_report"])).toBe(false);
  });
});

describe("markOnboardingStep", () => {
  it("upserts idempotently on (organization_id, step)", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ upsert })) };

    await markOnboardingStep({
      client,
      actor: {
        userId: "user-1",
        name: "Owner",
        role: "owner",
        organizationId: "org-1",
      },
      step: "create_project",
    });

    expect(upsert).toHaveBeenCalledWith(
      {
        organization_id: "org-1",
        step: "create_project",
        completed_by: "user-1",
      },
      { onConflict: "organization_id,step", ignoreDuplicates: true },
    );
  });
});
