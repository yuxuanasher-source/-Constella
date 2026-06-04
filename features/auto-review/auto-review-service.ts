import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";

import {
  evaluateAutoReview,
  type AutoReviewReportSnapshot,
  type AutoReviewResult,
  type AutoReviewRule,
} from "./auto-review-engine";
import type { AutoReviewRolloutGateResult } from "./auto-review-rollout-gates";

type AutoReviewClient = {
  from(table: "audit_logs"): unknown;
};

type AutoReviewActor = Pick<
  AuthContext,
  "userId" | "name" | "role" | "organizationId"
>;

type ApproveReportForAutoReview = (input: {
  actor: AutoReviewActor;
  reportId: string;
  input: {
    decision: "approve";
    includeInTaskResult: true;
    enterSettlementPool: true;
    reviewNotes: string;
    reason: string;
  };
}) => Promise<unknown>;

export async function evaluateAutoReviewShadow({
  client,
  actor,
  report,
  rule,
}: {
  client: AutoReviewClient;
  actor: AutoReviewActor;
  report: AutoReviewReportSnapshot;
  rule: AutoReviewRule;
}): Promise<AutoReviewResult> {
  const result = evaluateAutoReview(report, { ...rule, mode: "shadow" });

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "approve",
    module: "auto_review",
    objectType: "live_report",
    objectId: report.id,
    after: {
      ruleId: rule.id,
      decision: result.decision,
      mode: result.mode,
      confidence: result.confidence,
      reasons: result.reasons,
      failedGates: result.failedGates,
    },
    changedFields: ["shadow_decision"],
  });

  return result;
}

export async function evaluateAutoReviewActive({
  client,
  actor,
  report,
  rule,
  approveReport,
  rolloutGate,
}: {
  client: AutoReviewClient;
  actor: AutoReviewActor;
  report: AutoReviewReportSnapshot;
  rule: AutoReviewRule;
  approveReport: ApproveReportForAutoReview;
  rolloutGate?: AutoReviewRolloutGateResult;
}): Promise<AutoReviewResult & { applied: boolean }> {
  if (rule.mode !== "active") {
    throw new Error("Active auto review requires active rule version");
  }
  if (
    rolloutGate &&
    (rolloutGate.allowed !== true || rolloutGate.effectiveMode !== "active")
  ) {
    throw new Error("Active auto review blocked by rollout gate");
  }

  const result = evaluateAutoReview(report, rule);
  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "approve",
    module: "auto_review",
    objectType: "live_report",
    objectId: report.id,
    after: {
      ruleId: rule.id,
      decision: result.decision,
      mode: result.mode,
      confidence: result.confidence,
      reasons: result.reasons,
      failedGates: result.failedGates,
    },
    changedFields: ["active_decision"],
  });

  if (result.decision !== "auto_pass_candidate") {
    return { ...result, applied: false };
  }

  await approveReport({
    actor,
    reportId: report.id,
    input: {
      decision: "approve",
      includeInTaskResult: true,
      enterSettlementPool: true,
      reviewNotes: `Auto review passed by rule ${rule.id}`,
      reason: `auto_review:${rule.id}`,
    },
  });

  return { ...result, applied: true };
}
