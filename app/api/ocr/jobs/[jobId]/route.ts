import { NextResponse } from "next/server";

import { getOcrJob, retryOcrJob } from "@/features/ai/ocr-jobs";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

export const GET = withAuth<{ jobId: string }>(
  async ({ supabase, auth, params }) => {
    const denied = requireMcnStaff(auth.role);
    if (denied) {
      return denied;
    }

    const { jobId } = params;
    const job = await getOcrJob({ client: supabase as never, jobId });
    if (!job || job.organizationId !== auth.organizationId) {
      return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
    }

    return NextResponse.json({ job: toSafeJob(job) });
  },
);

export const POST = withAuth<{ jobId: string }>(
  async ({ supabase, auth, request, params }) => {
    const denied = requireMcnStaff(auth.role);
    if (denied) {
      return denied;
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (body.action !== "retry") {
      return NextResponse.json(
        { error: "Unsupported OCR job action" },
        { status: 400 },
      );
    }

    const { jobId } = params;
    const job = await retryOcrJob({
      client: supabase as never,
      actor: auth,
      jobId,
    });
    if (job.organizationId !== auth.organizationId) {
      return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
    }

    return NextResponse.json({ job: toSafeJob(job) });
  },
);

function requireMcnStaff(role: AppRole): NextResponse | null {
  if (!isMcnStaff(role)) {
    return NextResponse.json(
      { error: "Only MCN staff can manage OCR jobs" },
      { status: 403 },
    );
  }
  return null;
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
