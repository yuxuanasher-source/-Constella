import { NextResponse } from "next/server";

import { createOcrJob, listOcrJobs } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { canManageOcrJobs } from "@/lib/rbac/permissions";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request?: Request) {
  try {
    const authResult = await requireMcnStaff();
    if (authResult.response) {
      return authResult.response;
    }
    const status = request
      ? new URL(request.url).searchParams.get("status") || undefined
      : undefined;

    const jobs = await listOcrJobs({
      client: authResult.supabase as never,
      organizationId: authResult.auth.organizationId,
      status,
    });

    return NextResponse.json({ jobs: jobs.map(toSafeJob) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireMcnStaff();
    if (authResult.response) {
      return authResult.response;
    }
    if (!canManageOcrJobs(authResult.auth.role)) {
      return NextResponse.json(
        { error: "Current role cannot manage OCR jobs" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const job = await createOcrJob({
      client: authResult.supabase as never,
      actor: authResult.auth,
      input: {
        liveReportId: requiredString(body.liveReportId, "liveReportId"),
        screenshotId: optionalString(body.screenshotId),
        imageBase64: optionalString(body.imageBase64),
        imageUrl: optionalString(body.imageUrl),
        expectedDuration: optionalNumber(body.expectedDuration),
      },
    });

    return NextResponse.json({ job: toSafeJob(job) });
  } catch (error) {
    return errorResponse(error);
  }
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
