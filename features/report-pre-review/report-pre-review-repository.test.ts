import { describe, expect, it, vi } from "vitest";

import {
  appendReportPreReviewResult,
  getReportPreReviewSnapshot,
  listLatestReportPreReviewResults,
} from "./report-pre-review-repository";
import type { ReportPreReviewResult } from "./report-pre-review-engine";

function createQuery(data: unknown, error: Error | null = null) {
  const calls: Array<[string, unknown[]]> = [];
  const query = {
    calls,
    select(...args: unknown[]) {
      calls.push(["select", args]);
      return this;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return this;
    },
    in(...args: unknown[]) {
      calls.push(["in", args]);
      return this;
    },
    order(...args: unknown[]) {
      calls.push(["order", args]);
      return this;
    },
    limit(...args: unknown[]) {
      calls.push(["limit", args]);
      return this;
    },
    maybeSingle() {
      calls.push(["maybeSingle", []]);
      return Promise.resolve({ data, error });
    },
    insert(...args: unknown[]) {
      calls.push(["insert", args]);
      return this;
    },
    single() {
      calls.push(["single", []]);
      return Promise.resolve({ data, error });
    },
    returns() {
      calls.push(["returns", []]);
      return Promise.resolve({ data, error });
    },
  };
  return query;
}

describe("report pre-review repository", () => {
  it("builds a safe report snapshot without raw OCR or screenshot payloads", async () => {
    const query = createQuery({
      id: "report-1",
      organization_id: "org-1",
      status: "pending_review",
      settlement_duration: 120,
      system_duration: null,
      screenshot_duration: 118,
      time_source: "system",
      evidence_level: "green",
      risk_flags: [],
      live_tasks: {
        planned_duration: 120,
        system_duration: 121,
        anomaly_flags: [],
      },
      projects: { sensitivity: "normal" },
      streamers: {
        risk_level: "low",
        auto_trust: "trusted",
        clean_report_count: 8,
      },
      ocr_results: [{ status: "succeeded", raw_result: { text: "secret" } }],
      report_screenshots: [
        { id: "shot-1", storage_path: "private/raw.png", file_hash: "hash" },
      ],
    });
    const client = { from: vi.fn(() => query) };

    const snapshot = await getReportPreReviewSnapshot(client as never, {
      organizationId: "org-1",
      reportId: "report-1",
    });

    expect(snapshot).toEqual({
      reportId: "report-1",
      status: "pending_review",
      evidenceLevel: "green",
      timeSource: "system",
      settlementDuration: 120,
      systemDuration: 121,
      screenshotDuration: 118,
      screenshotCount: 1,
      ocrStatus: "succeeded",
      riskFlags: [],
      taskHasAnomaly: false,
      durationOverridden: false,
      projectSensitivity: "normal",
      streamerTrust: "trusted",
      plannedDuration: 120,
    });
    expect(client.from).toHaveBeenCalledWith("live_reports");
    expect(query.calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(query.calls).toContainEqual(["eq", ["id", "report-1"]]);
    expect(JSON.stringify(snapshot)).not.toContain("raw");
    expect(JSON.stringify(snapshot)).not.toContain("storage_path");
    expect(JSON.stringify(snapshot)).not.toContain("hash");
  });

  it("appends immutable pre-review results scoped to the organization", async () => {
    const query = createQuery({ id: "pre-review-1" });
    const client = { from: vi.fn(() => query) };
    const result: ReportPreReviewResult = {
      reportId: "report-1",
      decision: "quick_pass_candidate",
      confidence: "high",
      evidenceSummary: "Evidence is complete.",
      suggestedAction: "approve",
      reviewNoteDraft: "Suggested approval.",
      reasons: ["green_evidence"],
      failedGates: [],
      source: "deterministic",
      invocationId: "invocation-1",
    };

    const id = await appendReportPreReviewResult(client as never, {
      organizationId: "org-1",
      reportId: "report-1",
      result,
      statusSnapshot: { status: "pending_review" },
      createdBy: "user-ops",
    });

    expect(id).toBe("pre-review-1");
    expect(client.from).toHaveBeenCalledWith("report_pre_review_results");
    expect(query.calls).toContainEqual([
      "insert",
      [
        expect.objectContaining({
          organization_id: "org-1",
          live_report_id: "report-1",
          decision: "quick_pass_candidate",
          suggested_action: "approve",
          source: "deterministic",
          ai_invocation_id: "invocation-1",
          created_by: "user-ops",
          status_snapshot: { status: "pending_review" },
        }),
      ],
    ]);
  });

  it("returns only the latest summary per report", async () => {
    const query = createQuery([
      {
        id: "new-1",
        live_report_id: "report-1",
        decision: "manual_review",
        confidence: "medium",
        suggested_action: "review",
        evidence_summary: "new",
        review_note_draft: "new note",
        reasons: ["new_reason"],
        failed_gates: ["duration_divergence"],
        source: "deterministic",
        ai_invocation_id: "invocation-new",
        created_at: "2026-06-29T01:00:00.000Z",
      },
      {
        id: "old-1",
        live_report_id: "report-1",
        decision: "quick_pass_candidate",
        confidence: "high",
        suggested_action: "approve",
        evidence_summary: "old",
        review_note_draft: "old note",
        reasons: [],
        failed_gates: [],
        source: "deterministic",
        ai_invocation_id: "invocation-old",
        created_at: "2026-06-29T00:00:00.000Z",
      },
    ]);
    const client = { from: vi.fn(() => query) };

    const results = await listLatestReportPreReviewResults(client as never, {
      organizationId: "org-1",
      reportIds: ["report-1", "report-2"],
    });

    expect(results).toEqual([
      {
        id: "new-1",
        reportId: "report-1",
        decision: "manual_review",
        confidence: "medium",
        suggestedAction: "review",
        evidenceSummary: "new",
        reviewNoteDraft: "new note",
        reasons: ["new_reason"],
        failedGates: ["duration_divergence"],
        source: "deterministic",
        invocationId: "invocation-new",
        createdAt: "2026-06-29T01:00:00.000Z",
      },
    ]);
    expect(query.calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(query.calls).toContainEqual([
      "in",
      ["live_report_id", ["report-1", "report-2"]],
    ]);
  });
});
