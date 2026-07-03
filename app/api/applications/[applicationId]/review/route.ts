import { NextResponse } from "next/server";

import {
  normalizeReasonCodes,
  type AdmissionCheckpointVerdict,
} from "@/features/admission-review/contracts";
import {
  recordAdmissionEvaluation,
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "@/features/admission-review/evaluation-service";
import { recordAiVsMcnSignal } from "@/features/admission-review/signals";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/applications/application-route-utils";
import { reviewRecordingSubmission } from "@/features/applications/application-service";

const reviewDecisions = new Set(["approved", "rejected", "needs_changes"]);
const checkpointVerdicts = new Set(["pass", "fail", "not_applicable"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const body = await readJsonBody(request);
    const decision = requiredString(body, "decision");
    if (!reviewDecisions.has(decision)) {
      throw new Error("decision must be approved, rejected, or needs_changes");
    }

    const context = await getAdmissionRouteContext();
    const reviewClient = context.supabase as unknown as AdmissionReviewClient;
    const rubric = await resolveAdmissionRubric({
      client: reviewClient,
      organizationId: context.auth.organizationId,
    });

    // 理由码/卡点结果在入口即按当前 rubric 校验，未知 key 直接 400。
    const reasonCodes = normalizeReasonCodes(
      rubric,
      "mcn_first",
      readStringArray(body, "reasonCodes"),
    );
    const checkpointResults = readCheckpointResults(body);

    const application = await reviewRecordingSubmission({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: {
        applicationId,
        decision: decision as "approved" | "rejected" | "needs_changes",
        note: optionalString(body, "note"),
        reasonCodes,
        checkpointResults,
      },
      recordEvaluation: async (evaluation) => {
        await recordAdmissionEvaluation({
          client: reviewClient,
          rubric,
          input: {
            organizationId: evaluation.organizationId,
            applicationId: evaluation.applicationId,
            submissionId: evaluation.submissionId,
            stage: "mcn_first",
            decision: evaluation.decision,
            reviewerId: evaluation.reviewerId,
            note: evaluation.note,
            noteSource: evaluation.noteSource,
            reasonCodes: evaluation.reasonCodes,
            checkpointResults: evaluation.checkpointResults?.map((result) => ({
              checkpointKey: result.checkpointKey,
              verdict: result.verdict,
              note: result.note,
            })),
          },
        });
        // AI 预审 vs 一审对齐信号；失败不阻塞审核。
        await recordAiVsMcnSignal({
          client: reviewClient as never,
          organizationId: evaluation.organizationId,
          submissionId: evaluation.submissionId,
        }).catch(() => null);
      },
    });

    return NextResponse.json({ application });
  } catch (error) {
    return jsonError(error);
  }
}

function readStringArray(
  body: Record<string, unknown>,
  key: string,
): string[] {
  const value = body[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RouteError(`${key} must be an array of strings`, 400);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new RouteError(`${key} must be an array of strings`, 400);
    }
    return item;
  });
}

function readCheckpointResults(body: Record<string, unknown>):
  | Array<{
      checkpointKey: string;
      verdict: AdmissionCheckpointVerdict;
      note?: string;
    }>
  | undefined {
  const value = body.checkpointResults;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new RouteError("checkpointResults must be an array", 400);
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new RouteError("checkpointResults items must be objects", 400);
    }
    const record = item as Record<string, unknown>;
    const checkpointKey =
      typeof record.checkpointKey === "string"
        ? record.checkpointKey.trim()
        : "";
    const verdict =
      typeof record.verdict === "string" ? record.verdict.trim() : "";
    if (!checkpointKey || !checkpointVerdicts.has(verdict)) {
      throw new RouteError(
        "checkpointResults items need checkpointKey and verdict (pass/fail/not_applicable)",
        400,
      );
    }
    return {
      checkpointKey,
      verdict: verdict as AdmissionCheckpointVerdict,
      note:
        typeof record.note === "string" && record.note.trim()
          ? record.note.trim()
          : undefined,
    };
  });
}
