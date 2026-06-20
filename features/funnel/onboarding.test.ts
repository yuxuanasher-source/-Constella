import { describe, expect, it, vi } from "vitest";

import {
  isActivated,
  markOnboardingStep,
  recordOnboardingProgress,
  type OnboardingStep,
} from "./onboarding";

function fakeClient(initialSteps: OnboardingStep[]) {
  const upserts: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const steps = initialSteps.map((step) => ({ step }));
  const client = {
    from(table: string) {
      if (table === "onboarding_progress") {
        return {
          select: () => ({
            eq: () => ({
              returns: () => Promise.resolve({ data: steps, error: null }),
            }),
          }),
          upsert: async (payload: Record<string, unknown>) => {
            upserts.push(payload);
            return { error: null };
          },
        };
      }
      return {
        insert: async (payload: Record<string, unknown>) => {
          events.push(payload);
          return { error: null };
        },
      };
    },
  };
  return { client, upserts, events };
}

const ACTOR = {
  userId: "user-1",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

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

describe("recordOnboardingProgress", () => {
  it("marks the step and emits a step event without crossing activation", async () => {
    const { client, upserts, events } = fakeClient(["create_project"]);

    const result = await recordOnboardingProgress({
      client: client as never,
      actor: ACTOR,
      step: "add_streamer",
    });

    expect(result).toEqual({ activated: false, newlyActivated: false });
    expect(upserts).toHaveLength(1);
    expect(events.map((e) => e.event)).toEqual(["onboarding_step_completed"]);
  });

  it("emits an activated event when the threshold is newly crossed", async () => {
    const { client, events } = fakeClient(["create_project", "add_streamer"]);

    const result = await recordOnboardingProgress({
      client: client as never,
      actor: ACTOR,
      step: "submit_report",
    });

    expect(result).toEqual({ activated: true, newlyActivated: true });
    expect(events.map((e) => e.event)).toEqual([
      "onboarding_step_completed",
      "activated",
    ]);
  });

  it("does not re-emit activated when already activated", async () => {
    const { client, events } = fakeClient([
      "create_project",
      "add_streamer",
      "schedule_live",
    ]);

    const result = await recordOnboardingProgress({
      client: client as never,
      actor: ACTOR,
      step: "submit_report",
    });

    expect(result.newlyActivated).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["onboarding_step_completed"]);
  });
});
