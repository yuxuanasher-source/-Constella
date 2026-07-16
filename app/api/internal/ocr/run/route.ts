import { NextResponse } from "next/server";

import { runOcrWorkerIteration } from "@/features/ai/ocr-worker";
import { resolveOcrRunnerIdentity } from "@/features/ai/ocr-runner-identity";

export async function POST(request: Request) {
  const expected = process.env.OCR_RUNNER_TOKEN;
  const actual = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || actual !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    limit?: unknown;
  };
  // runner 身份解析与报数入队路由的进程内即时执行共用（ocr-runner-identity）。
  const identity = resolveOcrRunnerIdentity();
  if (!identity.ok) {
    return NextResponse.json(
      {
        error:
          identity.reason === "admin_client_unavailable"
            ? "Supabase admin client is unavailable"
            : "OCR runner organization and user are not configured",
      },
      { status: 500 },
    );
  }
  const { client: supabase, actor } = identity;

  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(Math.trunc(body.limit), 10))
      : 5;
  let result;
  try {
    result = await runOcrWorkerIteration({
      client: supabase as never,
      workerId: `ocr:http:${actor.userId}`,
      limit,
      leaseSeconds: 15 * 60,
    });
  } catch {
    return NextResponse.json(
      {
        errorCode: "claim_failed",
        errorMessage: "OCR runner could not claim jobs",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    jobs: result.jobs ?? [],
    failures: (result.failures ?? []).map((failure) => ({
      jobId: failure.jobId,
      errorCode: "runner_failed",
      errorMessage: sanitizeRunnerError(failure.errorMessage),
    })),
    summary: {
      claimed: result.claimed,
      succeeded: result.succeeded,
      failed: result.failed,
    },
  });
}

function sanitizeRunnerError(error: unknown): string {
  const message =
    typeof error === "string" && error.trim()
      ? error.trim()
      : error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "OCR runner failed";
  return message
    .replace(/tencent\s+ocr\s+credentials[^\n;]*/gi, "[redacted]")
    .replace(/[A-Za-z0-9_.-]+\/[^\s;]+/g, "[redacted]")
    .replace(/\s+with\s+secret[^\s;]*/gi, "")
    .replace(/secret[^\s;]*/gi, "[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 160);
}
