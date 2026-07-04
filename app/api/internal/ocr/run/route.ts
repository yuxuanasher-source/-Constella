import { NextResponse } from "next/server";

import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import { resolveOcrRunnerIdentity } from "@/features/ai/ocr-runner-identity";
import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
} from "@/features/ai/providers/tencent-ocr-provider";
import { getPrivateStorageBucket } from "@/lib/config/env";

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
  const provider = createTencentOcrProvider(
    readTencentOcrConfigFromEnv(process.env),
  );
  let jobs;
  try {
    jobs = await claimRunnableOcrJobs({
      client: supabase as never,
      organizationId: actor.organizationId,
      runnerId: actor.userId,
      limit,
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

  const completed = [];
  const failures = [];
  for (const job of jobs) {
    try {
      const result = await runOcrJobOnce({
        client: supabase as never,
        actor,
        jobId: job.id,
        provider,
        runnerId: actor.userId,
        imageResolver: (payload) =>
          resolveOcrImageInput({
            client: supabase,
            payload,
            defaultBucket: getPrivateStorageBucket(),
          }),
      });
      completed.push({
        id: result.id,
        status: result.status,
        attempt: result.attempt,
      });
    } catch (error) {
      failures.push({
        jobId: job.id,
        errorCode: "runner_failed",
        errorMessage: sanitizeRunnerError(error),
      });
    }
  }

  return NextResponse.json({ jobs: completed, failures });
}

function sanitizeRunnerError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "OCR runner failed";
  return message
    .replace(/[A-Za-z0-9_.-]+\/[^\s;]+/g, "[redacted]")
    .replace(/\s+with\s+secret[^\s;]*/gi, "")
    .replace(/secret[^\s;]*/gi, "[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 160);
}
