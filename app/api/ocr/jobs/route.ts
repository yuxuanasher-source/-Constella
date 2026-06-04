import { NextResponse } from "next/server";

import { createOcrJob, listOcrJobs } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
  try {
    const authResult = await requireMcnStaff();
    if (authResult.response) {
      return authResult.response;
    }

    const jobs = await listOcrJobs({
      client: authResult.supabase,
      organizationId: authResult.auth.organizationId,
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

    const body = (await request.json()) as Record<string, unknown>;
    const job = await createOcrJob({
      client: authResult.supabase,
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
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
