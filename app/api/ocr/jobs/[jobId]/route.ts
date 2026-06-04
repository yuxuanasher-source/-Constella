import { NextResponse } from "next/server";

import { getOcrJob, retryOcrJob } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
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
    const job = await getOcrJob({ client: authResult.supabase as never, jobId });
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

    const body = (await request.json()) as Record<string, unknown>;
    if (body.action !== "retry") {
      return NextResponse.json({ error: "Unsupported OCR job action" }, { status: 400 });
    }

    const { jobId } = await context.params;
    const job = await retryOcrJob({
      client: authResult.supabase as never,
      actor: authResult.auth,
      jobId,
    });
    if (job.organizationId !== authResult.auth.organizationId) {
      return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
    }

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
  aiInvocationId?: string;
  payload: { liveReportId?: string; screenshotId?: string };
}) {
  return {
    id: job.id,
    status: job.status,
    attempt: job.attempt,
    aiInvocationId: job.aiInvocationId,
    liveReportId: job.payload.liveReportId,
    screenshotId: job.payload.screenshotId,
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
