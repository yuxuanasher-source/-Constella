import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";

import {
  evaluateAutoReview,
  type AutoReviewReportSnapshot,
  type AutoReviewResult,
  type AutoReviewRule,
} from "./auto-review-engine";

type AutoReviewClient = {
  from(table: "audit_logs"): unknown;
};

export async function evaluateAutoReviewShadow({
  client,
  actor,
  report,
  rule,
}: {
  client: AutoReviewClient;
  actor: Pick<AuthContext, "userId" | "name" | "role" | "organizationId">;
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
