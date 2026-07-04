import { NextResponse } from "next/server";

import {
  claimAndRunRecordingAiAnalyses,
  runRecordingAiAnalysisOnce,
} from "@/features/recordings/recording-ai-analysis";
import { createRecordingAiAnalysisPipeline } from "@/features/recordings/recording-ai-pipeline";
import { resolveRecordingAiRunnerIdentity } from "@/features/recordings/recording-ai-runner-identity";

export async function POST(request: Request) {
  const expected = process.env.RECORDING_AI_RUNNER_TOKEN;
  const actual = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || actual !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // runner 身份解析与入队路由的进程内即时执行共用（recording-ai-runner-identity）。
  const identity = resolveRecordingAiRunnerIdentity();
  if (!identity.ok) {
    return NextResponse.json(
      {
        error:
          identity.reason === "admin_client_unavailable"
            ? "Supabase admin client is unavailable"
            : "Recording AI runner organization and user are not configured",
      },
      { status: 500 },
    );
  }
  const { client: supabase, actor } = identity;

  const body = (await request.json().catch(() => ({}))) as {
    analysisId?: unknown;
    limit?: unknown;
  };

  // 豆包 ASR + LLM 流水线；未配置（返回 null）时 runner 走确定性草稿。
  const pipeline = createRecordingAiAnalysisPipeline({
    client: supabase as never,
    actor,
  });

  // Single-run mode: an explicit analysisId keeps the original contract.
  if (body.analysisId !== undefined) {
    const analysisId =
      typeof body.analysisId === "string" ? body.analysisId.trim() : "";
    if (!analysisId) {
      return NextResponse.json(
        { error: "Recording analysis id is required" },
        { status: 400 },
      );
    }

    try {
      const analysis = await runRecordingAiAnalysisOnce({
        client: supabase as never,
        actor,
        analysisId,
        pipeline,
      });

      return NextResponse.json({ analysis });
    } catch (error) {
      return NextResponse.json(
        {
          errorCode: "runner_failed",
          errorMessage: sanitizeRunnerError(error),
        },
        { status: 500 },
      );
    }
  }

  // Claim mode: no analysisId means "claim the next batch of queued analyses
  // and run them" (used by the scheduled runner).
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(Math.trunc(body.limit), 10))
      : 5;

  let result;
  try {
    result = await claimAndRunRecordingAiAnalyses({
      client: supabase as never,
      actor,
      limit,
      pipeline,
    });
  } catch {
    return NextResponse.json(
      {
        errorCode: "claim_failed",
        errorMessage: "Recording AI runner could not claim analyses",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    processed: result.analyses.length,
    analyses: result.analyses,
    failures: result.failures.map((failure) => ({
      analysisId: failure.analysisId,
      errorCode: "runner_failed",
      errorMessage: sanitizeRunnerMessage(failure.errorSummary),
    })),
  });
}

function sanitizeRunnerError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Recording AI runner failed";
  return sanitizeRunnerMessage(message);
}

function sanitizeRunnerMessage(message: string): string {
  const trimmed = message.trim() || "Recording AI runner failed";
  return trimmed
    .replace(/[A-Za-z0-9_.-]+\/[^\s;]+/g, "[redacted]")
    .replace(/secret=([^\s;]+)/gi, "secret=[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 200);
}
