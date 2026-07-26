import { describe, expect, it, vi } from "vitest";

import { getStreamerProfileRow, listStreamerPool } from "./streamer-queries";

describe("streamer queries", () => {
  it("loads confirmed profile insights for pool cards and profile pages", async () => {
    const pool = queryBuilder([]);
    const profile = queryBuilder(null);
    const from = vi.fn((table: string) => {
      if (table !== "streamers") {
        throw new Error(`unexpected table ${table}`);
      }
      return from.mock.calls.length === 1 ? pool : profile;
    });
    const client = { from };

    await listStreamerPool(client as never, "org-1");
    await getStreamerProfileRow(client as never, "streamer-1");

    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining("streamer_profile_insights"),
    );
    expect(profile.select).toHaveBeenCalledWith(
      expect.stringContaining("streamer_profile_insights"),
    );
  });

  it("loads report-scoped settlement and GMV evidence for real economics", async () => {
    const pool = queryBuilder([]);
    const profile = queryBuilder(null);
    const from = vi.fn(() => (from.mock.calls.length === 1 ? pool : profile));
    const client = { from };

    await listStreamerPool(client as never, "org-1");
    await getStreamerProfileRow(client as never, "streamer-1");

    for (const query of [pool, profile]) {
      expect(query.select).toHaveBeenCalledWith(
        expect.stringContaining(
          "settlement_batch_items!settlement_batch_items_live_report_id_fkey(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status))",
        ),
      );
      expect(query.select).toHaveBeenCalledWith(
        expect.stringContaining(
          "settlement_batch_item_reports(settlement_batch_item_id, settlement_batch_items(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status)))",
        ),
      );
      expect(query.select).toHaveBeenCalledWith(
        expect.stringContaining(
          "streamer_metrics(source_report_id, metric_key, metric_value)",
        ),
      );
      expect(query.select).toHaveBeenCalledWith(
        expect.stringContaining("live_reports(id, live_task_id, status"),
      );
    }
    expect(pool.eq).toHaveBeenCalledWith(
      "live_reports.settlement_batch_items.organization_id",
      "org-1",
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "live_reports.streamer_metrics.organization_id",
      "org-1",
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "live_reports.settlement_batch_item_reports.organization_id",
      "org-1",
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "live_reports.settlement_batch_items.settlement_batches.organization_id",
      "org-1",
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "live_reports.settlement_batch_item_reports.settlement_batch_items.settlement_batches.organization_id",
      "org-1",
    );
  });

  it("selects and aggregates vendor admission reviews for the streamer pool", async () => {
    const pool = queryBuilder([
      {
        id: "streamer-1",
        display_name: "Streamer One",
        real_name: null,
        gender: null,
        source_type: "external",
        cooperation_status: "active",
        categories: [],
        platforms: [],
        styles: [],
        default_settlement_method: "cpt",
        risk_level: "low",
        clean_report_count: 0,
        created_at: "2026-07-26T00:00:00.000Z",
        project_applications: [
          {
            organization_id: "org-1",
            project_recording_vendor_reviews: [
              {
                id: "vendor-review-1",
                organization_id: "org-1",
                decision: "selected",
              },
            ],
            admission_review_evaluations: [
              {
                id: "evaluation-1",
                submission_id: "submission-1",
                organization_id: "org-1",
                stage: "vendor_second",
                decision: "selected",
                created_at: "2026-07-26T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
              {
                id: "evaluation-mcn-1",
                submission_id: "submission-1",
                organization_id: "org-1",
                stage: "mcn_first",
                decision: "approved",
                created_at: "2026-07-26T00:00:00.000Z",
                admission_review_checkpoint_results: [],
              },
            ],
          },
        ],
      },
    ]);
    const client = { from: vi.fn(() => pool) };

    const rows = await listStreamerPool(client as never, "org-1");

    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining("admission_review_evaluations"),
    );
    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining(
        "admission_review_evaluations(id, vendor_review_id, submission_id, organization_id, stage, decision, created_at",
      ),
    );
    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining(
        "admission_review_checkpoint_results(organization_id, checkpoint_key, verdict)",
      ),
    );
    expect(pool.select).toHaveBeenCalledWith(
      expect.stringContaining(
        "project_recording_vendor_reviews(id, organization_id, decision)",
      ),
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "project_applications.organization_id",
      "org-1",
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "project_applications.admission_review_evaluations.organization_id",
      "org-1",
    );
    expect(pool.in).toHaveBeenCalledWith(
      "project_applications.admission_review_evaluations.stage",
      ["vendor_second", "mcn_first"],
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "project_applications.project_recording_vendor_reviews.organization_id",
      "org-1",
    );
    expect(pool.in).toHaveBeenCalledWith(
      "project_applications.project_recording_vendor_reviews.decision",
      ["selected", "backup", "rejected", "needs_changes"],
    );
    expect(pool.eq).toHaveBeenCalledWith(
      "project_applications.admission_review_evaluations.admission_review_checkpoint_results.verdict",
      "fail",
    );
    expect(rows[0].admission_stats).toEqual({
      vendorPassRateBps: 10_000,
      rejectionReasonHistogram: {},
      evaluatedCount: 1,
      mcnFirstPassRateBps: 10_000,
      mcnFirstEvaluatedCount: 1,
    });
  });

  it("filters the pool by organization and bounds the main query", async () => {
    const pool = queryBuilder([]);
    const client = { from: vi.fn(() => pool) };

    await listStreamerPool(client as never, "org-1");

    expect(pool.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(200);
  });

  it("bounds nested relations with per-streamer recency windows", async () => {
    const pool = queryBuilder([]);
    const client = { from: vi.fn(() => pool) };

    await listStreamerPool(client as never, "org-1");

    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "recording_submissions",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(50, {
      referencedTable: "recording_submissions",
    });
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "streamer_profile_insights",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(20, {
      referencedTable: "streamer_profile_insights",
    });
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "live_tasks",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(200, {
      referencedTable: "live_tasks",
    });
    expect(pool.order).toHaveBeenCalledWith("created_at", {
      referencedTable: "live_reports",
      ascending: false,
    });
    expect(pool.limit).toHaveBeenCalledWith(200, {
      referencedTable: "live_reports",
    });
  });
});

function queryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}
