import { NextResponse } from "next/server";

import { findCheckpoint } from "@/features/admission-review/contracts";
import {
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "@/features/admission-review/evaluation-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/applications/application-route-utils";

// 校准配置：人工确认阈值提案后由 owner/ops_manager 在此落实。
// AI 只出提案草稿（L2），配置变更永远走人工 + 审计（高风险操作记原因）。
export async function PUT(request: Request) {
  try {
    const context = await getAdmissionRouteContext();
    if (
      context.auth.role !== "owner" &&
      context.auth.role !== "ops_manager"
    ) {
      throw new RouteError(
        "Only owner and ops_manager can update calibration",
        403,
      );
    }

    const body = await readJsonBody(request);
    const checkpointKey = requiredString(body, "checkpointKey");
    const reason = requiredString(body, "reason");
    const scoreCutoff = optionalBoundedNumber(body, "scoreCutoff", 0, 100);
    const minConfidence = optionalBoundedNumber(body, "minConfidence", 0, 1);
    if (scoreCutoff === undefined && minConfidence === undefined) {
      throw new RouteError(
        "scoreCutoff or minConfidence is required",
        400,
      );
    }

    const rubric = await resolveAdmissionRubric({
      client: context.supabase as unknown as AdmissionReviewClient,
      organizationId: context.auth.organizationId,
    });
    if (!findCheckpoint(rubric, checkpointKey)) {
      throw new RouteError(`Unknown checkpoint: ${checkpointKey}`, 400);
    }

    const { data, error } = await context.supabase
      .from("admission_review_calibration")
      .upsert(
        {
          organization_id: context.auth.organizationId,
          checkpoint_key: checkpointKey,
          score_cutoff: scoreCutoff ?? null,
          min_confidence: minConfidence ?? null,
          updated_by: context.auth.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,checkpoint_key" },
      )
      .select("checkpoint_key, score_cutoff, min_confidence, updated_at")
      .single();

    if (error) {
      throw error;
    }

    const actor = actorFromContext(context);
    await context.audit(context.supabase, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: "update",
      module: "admission_review",
      objectType: "admission_review_calibration",
      objectId: undefined,
      objectName: checkpointKey,
      after: {
        checkpointKey,
        scoreCutoff: scoreCutoff ?? null,
        minConfidence: minConfidence ?? null,
      },
      changedFields: ["score_cutoff", "min_confidence"],
      reason,
      isHighRisk: true,
    });

    return NextResponse.json({
      calibration: {
        checkpointKey: data.checkpoint_key,
        scoreCutoff: data.score_cutoff,
        minConfidence: data.min_confidence,
        updatedAt: data.updated_at,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function optionalBoundedNumber(
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new RouteError(`${key} must be a number between ${min} and ${max}`, 400);
  }
  return value;
}
