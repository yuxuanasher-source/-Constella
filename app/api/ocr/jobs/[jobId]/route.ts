import { NextResponse } from "next/server";

import {
  confirmOcrJob,
  getOcrJob,
  markOcrJobNeedsReview,
  retryOcrJob,
} from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { canManageOcrJobs } from "@/lib/rbac/permissions";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authResult = await requireMcnStaff();
    if (authResult.response) {
      return authResult.response;
    }

    const { jobId } = await context.params;
    const job = await getOcrJob({
      client: authResult.supabase as never,
      jobId,
    });
    if (!job || job.organizationId !== authResult.auth.organizationId) {
      return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
    }

    return NextResponse.json({ job: toSafeJob(job) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await requireMcnStaff();
    if (authResult.response) {
      return authResult.response;
    }

    const { jobId } = await context.params;
    const existing = await getOcrJob({
      client: authResult.supabase as never,
      jobId,
    });
    if (
      !existing ||
      existing.organizationId !== authResult.auth.organizationId
    ) {
      return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (!canManageOcrJobs(authResult.auth.role)) {
      return NextResponse.json(
        { error: "Current role cannot manage OCR jobs" },
        { status: 403 },
      );
    }

    if (body.action === "retry") {
      const job = await retryOcrJob({
        client: authResult.supabase as never,
        actor: authResult.auth,
        jobId,
      });
      return NextResponse.json({ job: toSafeJob(job) });
    }

    if (body.action === "confirm") {
      const job = await confirmOcrJob({
        client: authResult.supabase as never,
        actor: authResult.auth,
        jobId,
        manualResult: objectValue(body.manualResult),
      });
      return NextResponse.json({ job: toSafeJob(job) });
    }

    if (body.action === "needs_review") {
      const job = await markOcrJobNeedsReview({
        client: authResult.supabase as never,
        actor: authResult.auth,
        jobId,
        reason: optionalString(body.reason) ?? "manual_review_requested",
      });
      return NextResponse.json({ job: toSafeJob(job) });
    }

    return NextResponse.json(
      { error: "Unsupported OCR job action" },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function requireMcnStaff() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const auth = await getAuthContext(supabase);
  if (!auth) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!isMcnStaff(auth.role)) {
    return {
      response: NextResponse.json(
        { error: "Only MCN staff can manage OCR jobs" },
        { status: 403 },
      ),
    };
  }

  return { auth, supabase };
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

function errorResponse(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }

  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
