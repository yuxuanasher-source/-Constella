import type { AiActor } from "@/features/ai/contracts";
import {
  createAiInvocationId,
  recordAiInvocation,
} from "@/features/ai/invocation-ledger";

import type { AdmissionEvaluationDecision } from "./contracts";
import {
  recordAdmissionEvaluation,
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "./evaluation-service";
import { classifyVendorRemark } from "./remark-classifier";

// 厂家驳回备注归一化批处理：扫描尚无 vendor_second 评估的厂家驳回/需修改
// 记录，LLM（或关键词兜底）分类到理由码后落评估。厂家端零新增填写负担。

export const VENDOR_CLASSIFY_DEFAULT_LIMIT = 10;
export const VENDOR_CLASSIFY_MAX_LIMIT = 25;

type VendorReviewRow = {
  id: string;
  organization_id: string;
  application_id: string;
  recording_submission_id: string;
  decision: string;
  remark: string;
  submitted_at: string;
};

type VendorClassificationDb = {
  from(table: "project_recording_vendor_reviews"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        in(
          column: "decision",
          values: string[],
        ): {
          neq(
            column: "remark",
            value: string,
          ): {
            order(
              column: "submitted_at",
              options: { ascending: boolean },
            ): {
              limit(count: number): PromiseLike<{
                data: VendorReviewRow[] | null;
                error: Error | null;
              }>;
            };
          };
        };
      };
    };
  };
  from(table: "admission_review_evaluations"): {
    select(columns: string): {
      in(
        column: "vendor_review_id",
        values: string[],
      ): PromiseLike<{
        data: Array<{ vendor_review_id: string | null }> | null;
        error: Error | null;
      }>;
    };
  };
};

export type VendorClassificationRunResult = {
  processed: number;
  classified: Array<{
    vendorReviewId: string;
    reasonCodes: string[];
    confidence: "high" | "medium" | "low";
    source: "llm" | "deterministic";
  }>;
  failures: Array<{ vendorReviewId: string; errorSummary: string }>;
};

export async function classifyPendingVendorRemarks({
  client,
  actor,
  limit = VENDOR_CLASSIFY_DEFAULT_LIMIT,
  classify = classifyVendorRemark,
  recordInvocation = recordAiInvocation,
}: {
  client: AdmissionReviewClient &
    VendorClassificationDb &
    Parameters<typeof recordAiInvocation>[0]["client"];
  actor: AiActor;
  limit?: number;
  classify?: typeof classifyVendorRemark;
  recordInvocation?: typeof recordAiInvocation;
}): Promise<VendorClassificationRunResult> {
  const batchLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), VENDOR_CLASSIFY_MAX_LIMIT))
    : VENDOR_CLASSIFY_DEFAULT_LIMIT;

  const db = client as VendorClassificationDb;
  const { data, error } = await db
    .from("project_recording_vendor_reviews")
    .select(
      "id, organization_id, application_id, recording_submission_id, decision, remark, submitted_at",
    )
    .eq("organization_id", actor.organizationId)
    .in("decision", ["rejected", "needs_changes"])
    .neq("remark", "")
    .order("submitted_at", { ascending: true })
    // 预取更多候选，扣掉已归一化的再截断到 batchLimit。
    .limit(batchLimit * 4);

  if (error) {
    throw error;
  }

  const candidates = data ?? [];
  if (!candidates.length) {
    return { processed: 0, classified: [], failures: [] };
  }

  const { data: existing, error: existingError } = await db
    .from("admission_review_evaluations")
    .select("vendor_review_id")
    .in(
      "vendor_review_id",
      candidates.map((row) => row.id),
    );
  if (existingError) {
    throw existingError;
  }

  const alreadyClassified = new Set(
    (existing ?? [])
      .map((row) => row.vendor_review_id)
      .filter((id): id is string => Boolean(id)),
  );
  const pending = candidates
    .filter((row) => !alreadyClassified.has(row.id))
    .slice(0, batchLimit);

  if (!pending.length) {
    return { processed: 0, classified: [], failures: [] };
  }

  const rubric = await resolveAdmissionRubric({
    client,
    organizationId: actor.organizationId,
  });

  const classified: VendorClassificationRunResult["classified"] = [];
  const failures: VendorClassificationRunResult["failures"] = [];

  for (const review of pending) {
    try {
      const classification = await classify({
        remark: review.remark,
        rubric,
      });

      const invocationId = createAiInvocationId();
      await recordInvocation({
        client,
        actor,
        input: {
          id: invocationId,
          scene: "admission.classify_vendor_remark",
          objectType: "vendor_review",
          objectId: review.id,
          providerName:
            classification.source === "llm"
              ? classification.providerName
              : "deterministic",
          status: "succeeded",
          metadata: {
            source: classification.source,
            confidence: classification.confidence,
            reasonCodes: classification.reasonCodes,
          },
        },
      });

      await recordAdmissionEvaluation({
        client,
        rubric,
        input: {
          organizationId: review.organization_id,
          applicationId: review.application_id,
          submissionId: review.recording_submission_id,
          stage: "vendor_second",
          decision: review.decision as AdmissionEvaluationDecision,
          decisionConfidence: classification.confidence,
          vendorReviewId: review.id,
          aiInvocationId: invocationId,
          note: review.remark,
          noteSource: "llm_classified",
          reasonCodes: classification.reasonCodes,
        },
      });

      classified.push({
        vendorReviewId: review.id,
        reasonCodes: classification.reasonCodes,
        confidence: classification.confidence,
        source: classification.source,
      });
    } catch (error) {
      failures.push({
        vendorReviewId: review.id,
        errorSummary:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "classification failed",
      });
    }
  }

  return {
    processed: classified.length,
    classified,
    failures,
  };
}
