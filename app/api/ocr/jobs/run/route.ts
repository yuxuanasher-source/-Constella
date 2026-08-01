import { NextResponse } from "next/server";

import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
} from "@/features/ai/providers/tencent-ocr-provider";
import { getAuthContext } from "@/lib/auth/context";
import { getPrivateStorageBucket } from "@/lib/config/env";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { canManageOcrJobs } from "@/lib/rbac/permissions";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run OCR jobs" },
        { status: 403 },
      );
    }
    if (!canManageOcrJobs(auth.role)) {
      return NextResponse.json(
        { error: "Current role cannot manage OCR jobs" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      limit?: unknown;
    };
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(Math.trunc(body.limit), 10))
        : 1;
    const executionClient = createSupabaseAdminClient();
    if (!executionClient) {
      return NextResponse.json(
        { error: "OCR execution service is unavailable" },
        { status: 503 },
      );
    }
    const provider = createTencentOcrProvider(
      readTencentOcrConfigFromEnv(process.env),
    );
    const runnerId = auth.userId;
    const jobs = await claimRunnableOcrJobs({
      client: supabase as never,
      organizationId: auth.organizationId,
      runnerId,
      limit,
    });

    const completed = [];
    const failures = [];
    for (const job of jobs) {
      try {
        if (job.organizationId !== auth.organizationId) {
          throw new Error("OCR job organization mismatch");
        }
        const result = await runOcrJobOnce({
          client: executionClient as never,
          metricClient: executionClient as never,
          actor: auth,
          jobId: job.id,
          provider,
          runnerId,
          imageResolver: (payload) =>
            resolveOcrImageInput({
              client: supabase,
              payload,
              defaultBucket: getPrivateStorageBucket(),
            }),
        });
        completed.push(toSafeJob(result));
      } catch (error) {
        failures.push({
          jobId: job.id,
          errorCode: "runner_failed",
          errorMessage: sanitizeRunnerError(error),
        });
      }
    }

    return NextResponse.json({ jobs: completed, failures });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

function toSafeJob(job: {
  id: string;
  status: string;
  attempt: number;
  maxAttempts?: number;
  aiInvocationId?: string;
  runAfter?: string;
  nextRunAt?: string;
  lockedAt?: string;
  lockedBy?: string;
  errorCode?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  payload: { liveReportId?: string; screenshotId?: string };
}) {
  return {
    id: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts ?? 3,
    aiInvocationId: job.aiInvocationId,
    liveReportId: job.payload.liveReportId,
    screenshotId: job.payload.screenshotId,
    nextRunAt: job.nextRunAt ?? job.runAfter,
    lockedAt: job.lockedAt,
    lockedBy: job.lockedBy,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    result: job.result,
    reviewedBy: job.reviewedBy,
    reviewedAt: job.reviewedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function sanitizeRunnerError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "OCR runner failed";
  return message
    .replace(/\s+with\s+secret[^\s;]*/gi, "")
    .replace(/secret[^\s;]*/gi, "[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 160);
}
