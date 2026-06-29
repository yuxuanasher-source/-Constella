import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuditLogInput } from "@/lib/audit/audit";
import { isMcnStaff } from "@/lib/rbac/roles";
import type {
  AiActor,
  AiToolInvocationRecordInput,
} from "@/features/ai/contracts";
import {
  recordAiInvocation,
  type RecordAiInvocationInput,
} from "@/features/ai/invocation-ledger";
import { recordAiToolInvocation } from "@/features/ai/tool-ledger";

import {
  evaluateReportPreReview,
  type ReportPreReviewResult,
  type ReportPreReviewSnapshot,
} from "./report-pre-review-engine";
import {
  appendReportPreReviewResult,
  getReportPreReviewSnapshot,
  listLatestReportPreReviewResults,
  type ReportPreReviewSummary,
} from "./report-pre-review-repository";

type ReportPreReviewClient = SupabaseClient;

type AuditWriter = (input: AuditLogInput) => Promise<void>;
type SnapshotReader = (input: {
  organizationId: string;
  reportId: string;
}) => Promise<ReportPreReviewSnapshot | null>;
type ResultAppender = (input: {
  organizationId: string;
  reportId: string;
  result: ReportPreReviewResult;
  statusSnapshot: Record<string, unknown>;
  createdBy: string;
}) => Promise<string>;
type InvocationRecorder = (input: RecordAiInvocationInput) => Promise<string>;
type ToolInvocationRecorder = (input: {
  invocationId: string;
  input: AiToolInvocationRecordInput;
}) => Promise<void>;
type SummaryLister = (input: {
  organizationId: string;
  reportIds?: string[];
  limit?: number;
}) => Promise<ReportPreReviewSummary[]>;

export type GenerateReportPreReviewOutput = {
  preReviewId: string;
  result: ReportPreReviewResult;
};

export async function generateReportPreReview({
  client,
  actor,
  reportId,
  getSnapshot = (input) => getReportPreReviewSnapshot(client, input),
  appendResult = (input) => appendReportPreReviewResult(client, input),
  recordInvocation = (input) => recordAiInvocation({ client, actor, input }),
  recordToolInvocation = (input) =>
    recordAiToolInvocation({
      client,
      actor,
      invocationId: input.invocationId,
      input: input.input,
    }),
  audit,
  updateLiveReport,
}: {
  client: ReportPreReviewClient;
  actor: AiActor;
  reportId: string;
  getSnapshot?: SnapshotReader;
  appendResult?: ResultAppender;
  recordInvocation?: InvocationRecorder;
  recordToolInvocation?: ToolInvocationRecorder;
  audit?: AuditWriter;
  updateLiveReport?: (...args: unknown[]) => unknown;
}): Promise<GenerateReportPreReviewOutput> {
  void updateLiveReport;
  assertCanGenerateReportPreReview(actor.role);

  const snapshot = await getSnapshot({
    organizationId: actor.organizationId,
    reportId,
  });
  if (!snapshot) {
    throw new Error("Live report not found");
  }
  if (snapshot.status !== "pending_review") {
    throw new Error("Only pending review reports can be pre-reviewed");
  }

  const deterministic = evaluateReportPreReview(snapshot);
  const invocationId = await recordInvocation({
    scene: "report_pre_review",
    objectType: "live_report",
    objectId: reportId,
    providerName: "deterministic",
    status: "succeeded",
    metadata: {
      decision: deterministic.decision,
      confidence: deterministic.confidence,
      source: deterministic.source,
    },
  });
  const result = { ...deterministic, invocationId };

  await recordToolInvocation({
    invocationId,
    input: {
      toolName: "live_report_pre_review_snapshot",
      inputSummary: { reportId },
      outputSummary: {
        decision: result.decision,
        failedGates: result.failedGates,
        screenshotCount: snapshot.screenshotCount,
      },
      scopes: ["mcn_staff"],
      readOnly: true,
      allowed: true,
      status: "succeeded",
    },
  });

  const preReviewId = await appendResult({
    organizationId: actor.organizationId,
    reportId,
    result,
    statusSnapshot: toStatusSnapshot(snapshot),
    createdBy: actor.userId,
  });

  await audit?.({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "report_pre_review",
    objectType: "live_report",
    objectId: reportId,
    after: {
      preReviewId,
      decision: result.decision,
      confidence: result.confidence,
      suggestedAction: result.suggestedAction,
      source: result.source,
    },
    changedFields: ["decision", "confidence", "suggested_action"],
    isHighRisk: result.decision === "high_risk_blocked",
    reason:
      result.decision === "high_risk_blocked"
        ? "report_pre_review_high_risk"
        : undefined,
  });

  return { preReviewId, result };
}

export async function listReportPreReviewSummaries({
  client,
  actor,
  reportIds,
  limit,
  listLatest = (input) => listLatestReportPreReviewResults(client, input),
}: {
  client: ReportPreReviewClient;
  actor: AiActor;
  reportIds?: string[];
  limit?: number;
  listLatest?: SummaryLister;
}): Promise<ReportPreReviewSummary[]> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Current role cannot read report pre-review");
  }

  return listLatest({
    organizationId: actor.organizationId,
    reportIds,
    limit,
  });
}

function assertCanGenerateReportPreReview(role: AiActor["role"]): void {
  if (
    role !== "owner" &&
    role !== "ops_manager" &&
    role !== "operator_business"
  ) {
    throw new Error("Current role cannot generate report pre-review");
  }
}

function toStatusSnapshot(
  snapshot: ReportPreReviewSnapshot,
): Record<string, unknown> {
  return {
    status: snapshot.status,
    evidenceLevel: snapshot.evidenceLevel,
    timeSource: snapshot.timeSource,
    settlementDuration: snapshot.settlementDuration,
    systemDuration: snapshot.systemDuration,
    screenshotDuration: snapshot.screenshotDuration,
    screenshotCount: snapshot.screenshotCount,
    ocrStatus: snapshot.ocrStatus,
    riskFlags: snapshot.riskFlags,
    taskHasAnomaly: snapshot.taskHasAnomaly,
    durationOverridden: snapshot.durationOverridden,
    projectSensitivity: snapshot.projectSensitivity,
    streamerTrust: snapshot.streamerTrust,
    plannedDuration: snapshot.plannedDuration,
  };
}
