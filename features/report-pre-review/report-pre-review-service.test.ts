import { describe, expect, it, vi } from "vitest";

import {
  generateReportPreReview,
  listReportPreReviewSummaries,
} from "./report-pre-review-service";
import type { ReportPreReviewSnapshot } from "./report-pre-review-engine";

const cleanSnapshot: ReportPreReviewSnapshot = {
  reportId: "report-1",
  status: "pending_review",
  evidenceLevel: "green",
  timeSource: "system",
  settlementDuration: 120,
  systemDuration: 120,
  screenshotDuration: 119,
  screenshotCount: 1,
  ocrStatus: "succeeded",
  riskFlags: [],
  taskHasAnomaly: false,
  durationOverridden: false,
  projectSensitivity: "normal",
  streamerTrust: "trusted",
  plannedDuration: 120,
};

const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

describe("generateReportPreReview", () => {
  it("evaluates and stores a read-only pre-review with ledgers and audit", async () => {
    const getSnapshot = vi.fn(async () => cleanSnapshot);
    const appendResult = vi.fn(async () => "pre-review-1");
    const recordInvocation = vi.fn(async () => "invocation-1");
    const recordToolInvocation = vi.fn(async () => undefined);
    const audit = vi.fn(async () => undefined);
    const updateLiveReport = vi.fn();

    const output = await generateReportPreReview({
      client: {} as never,
      actor,
      reportId: "report-1",
      getSnapshot,
      appendResult,
      recordInvocation,
      recordToolInvocation,
      audit,
      updateLiveReport,
    });

    expect(output.preReviewId).toBe("pre-review-1");
    expect(output.result).toMatchObject({
      reportId: "report-1",
      decision: "quick_pass_candidate",
      suggestedAction: "approve",
      invocationId: "invocation-1",
    });
    expect(recordInvocation).toHaveBeenCalledWith({
      scene: "report_pre_review",
      objectType: "live_report",
      objectId: "report-1",
      providerName: "deterministic",
      status: "succeeded",
      metadata: {
        decision: "quick_pass_candidate",
        confidence: "high",
        source: "deterministic",
      },
    });
    expect(recordToolInvocation).toHaveBeenCalledWith({
      invocationId: "invocation-1",
      input: {
        toolName: "live_report_pre_review_snapshot",
        inputSummary: { reportId: "report-1" },
        outputSummary: {
          decision: "quick_pass_candidate",
          failedGates: [],
          screenshotCount: 1,
        },
        scopes: ["mcn_staff"],
        readOnly: true,
        allowed: true,
        status: "succeeded",
      },
    });
    expect(appendResult).toHaveBeenCalledWith({
      organizationId: "org-1",
      reportId: "report-1",
      result: expect.objectContaining({
        invocationId: "invocation-1",
        source: "deterministic",
      }),
      statusSnapshot: {
        status: "pending_review",
        evidenceLevel: "green",
        timeSource: "system",
        settlementDuration: 120,
        systemDuration: 120,
        screenshotDuration: 119,
        screenshotCount: 1,
        ocrStatus: "succeeded",
        riskFlags: [],
        taskHasAnomaly: false,
        durationOverridden: false,
        projectSensitivity: "normal",
        streamerTrust: "trusted",
        plannedDuration: 120,
      },
      createdBy: "user-ops",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-ops",
        actorRole: "ops_manager",
        action: "create",
        module: "report_pre_review",
        objectType: "live_report",
        objectId: "report-1",
        changedFields: ["decision", "confidence", "suggested_action"],
      }),
    );
    expect(updateLiveReport).not.toHaveBeenCalled();
  });

  it("rejects roles outside owner, ops manager, and business operator", async () => {
    const getSnapshot = vi.fn(async () => cleanSnapshot);
    const appendResult = vi.fn();

    await expect(
      generateReportPreReview({
        client: {} as never,
        actor: { ...actor, role: "finance" },
        reportId: "report-1",
        getSnapshot,
        appendResult,
      }),
    ).rejects.toThrow("Current role cannot generate report pre-review");

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(appendResult).not.toHaveBeenCalled();
  });

  it("refuses to pre-review reports outside pending review", async () => {
    const getSnapshot = vi.fn(async () => ({
      ...cleanSnapshot,
      status: "approved",
    }));
    const appendResult = vi.fn();

    await expect(
      generateReportPreReview({
        client: {} as never,
        actor,
        reportId: "report-1",
        getSnapshot,
        appendResult,
      }),
    ).rejects.toThrow("Only pending review reports can be pre-reviewed");

    expect(appendResult).not.toHaveBeenCalled();
  });

  it("reports missing live reports without writing a result", async () => {
    const getSnapshot = vi.fn(async () => null);
    const appendResult = vi.fn();

    await expect(
      generateReportPreReview({
        client: {} as never,
        actor,
        reportId: "missing-report",
        getSnapshot,
        appendResult,
      }),
    ).rejects.toThrow("Live report not found");

    expect(appendResult).not.toHaveBeenCalled();
  });
});

describe("listReportPreReviewSummaries", () => {
  it("allows MCN staff to read latest pre-review summaries", async () => {
    const listLatest = vi.fn(async () => [
      {
        id: "pre-review-1",
        reportId: "report-1",
        decision: "manual_review" as const,
        confidence: "medium" as const,
        suggestedAction: "review" as const,
        evidenceSummary: "summary",
        reviewNoteDraft: "note",
        reasons: [],
        failedGates: ["duration_divergence"],
        source: "deterministic" as const,
        createdAt: "2026-06-29T01:00:00.000Z",
      },
    ]);

    const summaries = await listReportPreReviewSummaries({
      client: {} as never,
      actor: { ...actor, role: "finance" },
      reportIds: ["report-1"],
      listLatest,
    });

    expect(summaries).toHaveLength(1);
    expect(listLatest).toHaveBeenCalledWith({
      organizationId: "org-1",
      reportIds: ["report-1"],
      limit: undefined,
    });
  });

  it("rejects streamers from reading pre-review summaries", async () => {
    await expect(
      listReportPreReviewSummaries({
        client: {} as never,
        actor: { ...actor, role: "streamer" },
      }),
    ).rejects.toThrow("Current role cannot read report pre-review");
  });
});
