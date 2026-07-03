import { describe, expect, it } from "vitest";

import { buildOutcomePayload, runPostJoinOutcomes } from "./outcome-job";

describe("buildOutcomePayload", () => {
  const base = { joinedAt: "2026-06-01T00:00:00.000Z", windowDays: 30 };

  it("marks regret when the streamer never went live", () => {
    const payload = buildOutcomePayload({ ...base, reports: [] });
    expect(payload.outcome).toBe("regret");
    expect(payload.totalReports).toBe(0);
  });

  it("marks regret when red evidence dominates", () => {
    const payload = buildOutcomePayload({
      ...base,
      reports: [
        { evidence_level: "red", risk_flags: [] },
        { evidence_level: "red", risk_flags: [] },
        { evidence_level: "green", risk_flags: [] },
      ],
    });
    expect(payload.outcome).toBe("regret");
    expect(payload.redReports).toBe(2);
  });

  it("marks watch when yellow or risk flags pile up", () => {
    const payload = buildOutcomePayload({
      ...base,
      reports: [
        { evidence_level: "yellow", risk_flags: [] },
        { evidence_level: "yellow", risk_flags: ["duration_divergence"] },
        { evidence_level: "green", risk_flags: [] },
        { evidence_level: "green", risk_flags: [] },
      ],
    });
    expect(payload.outcome).toBe("watch");
  });

  it("marks healthy for clean green histories", () => {
    const payload = buildOutcomePayload({
      ...base,
      reports: [
        { evidence_level: "green", risk_flags: [] },
        { evidence_level: "green", risk_flags: [] },
        { evidence_level: "green", risk_flags: [] },
      ],
    });
    expect(payload.outcome).toBe("healthy");
  });
});

describe("runPostJoinOutcomes", () => {
  function createOutcomeClient({
    applications = [
      {
        id: "application-1",
        organization_id: "org-1",
        project_id: "project-1",
        streamer_id: "streamer-1",
        decided_at: "2026-05-20T00:00:00.000Z",
      },
    ],
    submissions = [{ id: "submission-1" }],
    existingSignals = [] as Array<{ submission_id: string }>,
    reports = [
      { evidence_level: "green", risk_flags: [] as string[] },
    ],
  } = {}) {
    const upserts: Array<Record<string, unknown>> = [];
    return {
      upserts,
      from(table: string) {
        if (table === "project_applications") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  lt: () => ({
                    order: () => ({
                      limit: async () => ({ data: applications, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "recording_submissions") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: submissions, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "admission_review_signals") {
          return {
            select: () => ({
              in: () => ({
                eq: async () => ({ data: existingSignals, error: null }),
              }),
            }),
            upsert: async (payload: Record<string, unknown>) => {
              upserts.push(payload);
              return { error: null };
            },
          };
        }
        if (table === "live_reports") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ data: reports, error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  it("writes post_join_outcome signals for matured joins", async () => {
    const client = createOutcomeClient();

    const result = await runPostJoinOutcomes({
      client,
      actor: { organizationId: "org-1" },
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(result.processed).toBe(1);
    expect(result.outcomes[0]).toMatchObject({
      applicationId: "application-1",
      submissionId: "submission-1",
      outcome: "healthy",
    });

    const fake = client as unknown as {
      upserts: Array<Record<string, unknown>>;
    };
    expect(fake.upserts[0]).toMatchObject({
      signal_kind: "post_join_outcome",
      submission_id: "submission-1",
    });
  });

  it("skips applications that already have an outcome signal", async () => {
    const client = createOutcomeClient({
      existingSignals: [{ submission_id: "submission-1" }],
    });

    const result = await runPostJoinOutcomes({
      client,
      actor: { organizationId: "org-1" },
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(result.processed).toBe(0);
    expect(
      (client as unknown as { upserts: unknown[] }).upserts,
    ).toHaveLength(0);
  });
});
