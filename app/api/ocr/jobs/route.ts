import { NextResponse } from "next/server";

import { createOcrJob, listOcrJobs } from "@/features/ai/ocr-jobs";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

export const GET = withAuth(async ({ supabase, auth }) => {
  const denied = requireMcnStaff(auth.role);
  if (denied) {
    return denied;
  }

  const jobs = await listOcrJobs({
    client: supabase as never,
    organizationId: auth.organizationId,
  });

  return NextResponse.json({ jobs: jobs.map(toSafeJob) });
});

export const POST = withAuth(async ({ supabase, auth, request }) => {
  const denied = requireMcnStaff(auth.role);
  if (denied) {
    return denied;
  }

  const body = (await request.json()) as Record<string, unknown>;
  const job = await createOcrJob({
    client: supabase as never,
    actor: auth,
    input: {
      liveReportId: requiredString(body.liveReportId, "liveReportId"),
      screenshotId: optionalString(body.screenshotId),
      imageBase64: optionalString(body.imageBase64),
      imageUrl: optionalString(body.imageUrl),
      expectedDuration: optionalNumber(body.expectedDuration),
    },
  });

  return NextResponse.json({ job: toSafeJob(job) });
});

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
