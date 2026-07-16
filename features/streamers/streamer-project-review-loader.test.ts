import { describe, expect, it, vi } from "vitest";

import { loadStreamerProjectReviewInput } from "./streamer-project-review-loader";

function createClient(fixtures: Record<string, unknown[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    from: vi.fn((table: string) => {
      calls.push(["from", [table]]);
      const builder = {
        select: vi.fn((columns: string) => {
          calls.push(["select", [table, columns]]);
          return builder;
        }),
        eq: vi.fn((column: string, value: string) => {
          calls.push(["eq", [table, column, value]]);
          return builder;
        }),
        in: vi.fn((column: string, values: string[]) => {
          calls.push(["in", [table, column, values]]);
          return builder;
        }),
        order: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({
          data: fixtures[table]?.[0] ?? null,
          error: null,
        })),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: fixtures[table] ?? [], error: null }),
      };
      return builder;
    }),
  };
  return { client, calls };
}

describe("loadStreamerProjectReviewInput", () => {
  it("loads streamer, project, schedule, reports, and recordings into review input", async () => {
    const { client, calls } = createClient({
      streamers: [{ id: "streamer-1", display_name: "阿星" }],
      projects: [
        {
          id: "project-1",
          name: "传奇复古",
          product_name: "legend",
        },
      ],
      live_tasks: [
        {
          id: "task-1",
          planned_start_at: "2026-07-01T10:00:00.000Z",
          planned_end_at: "2026-07-01T12:00:00.000Z",
          status: "completed",
          system_duration: 120,
        },
      ],
      live_reports: [
        {
          id: "report-1",
          live_task_id: "task-1",
          status: "approved",
          settlement_duration: 120,
          system_duration: 120,
          viewers: 2400,
          evidence_level: "green",
          risk_flags: [],
          created_at: "2026-07-01T12:05:00.000Z",
        },
      ],
      ocr_results: [
        {
          live_report_id: "report-1",
          raw_result: {
            metricCandidates: [
              { key: "pcu", value: 320 },
              { key: "acu", value: 90 },
            ],
          },
        },
      ],
      project_applications: [
        {
          id: "application-1",
          project_id: "project-1",
          streamer_id: "streamer-1",
        },
      ],
      recording_submissions: [
        {
          id: "rec-1",
          status: "approved",
          duration_seconds: 1800,
          decision_reason: null,
        },
      ],
    });

    const input = await loadStreamerProjectReviewInput({
      supabase: client as never,
      organizationId: "org-1",
      streamerId: "streamer-1",
      projectId: "project-1",
    });

    expect(input).toMatchObject({
      streamer: { id: "streamer-1", displayName: "阿星" },
      project: { id: "project-1", name: "传奇复古", productType: "legend" },
      tasks: [
        {
          id: "task-1",
          plannedStartAt: "2026-07-01T10:00:00.000Z",
          plannedEndAt: "2026-07-01T12:00:00.000Z",
          status: "completed",
          systemDuration: 120,
        },
      ],
      reports: [
        {
          id: "report-1",
          taskId: "task-1",
          status: "approved",
          settlementDuration: 120,
          viewers: 2400,
          pcu: 320,
          acu: 90,
          evidenceLevel: "green",
        },
      ],
      recordings: [
        {
          id: "rec-1",
          status: "approved",
          adopted: true,
          rejectionReasons: [],
          durationSeconds: 1800,
        },
      ],
    });
    expect(calls).toContainEqual(["eq", ["streamers", "organization_id", "org-1"]]);
    expect(calls).toContainEqual(["eq", ["live_tasks", "project_id", "project-1"]]);
    expect(calls).toContainEqual([
      "in",
      ["ocr_results", "live_report_id", ["report-1"]],
    ]);
    expect(calls).toContainEqual([
      "in",
      ["recording_submissions", "application_id", ["application-1"]],
    ]);
  });

  it("fails closed when streamer or project is outside the organization", async () => {
    const { client } = createClient({
      streamers: [],
      projects: [{ id: "project-1", name: "传奇复古", product_name: "legend" }],
    });

    await expect(
      loadStreamerProjectReviewInput({
        supabase: client as never,
        organizationId: "org-1",
        streamerId: "streamer-1",
        projectId: "project-1",
      }),
    ).rejects.toThrow("Streamer project review target not found");
  });
});
