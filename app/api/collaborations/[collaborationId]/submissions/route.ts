import { NextResponse } from "next/server";

import { listCollaborationSubmissions } from "@/features/collaborations/collaboration-queries";
import { SupabaseCollaborationSubmissionRepository } from "@/features/collaborations/collaboration-repository";
import { submitCollaborationContent } from "@/features/collaborations/collaboration-submission-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { sendNotification } from "@/lib/notify/notify";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collaborationId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { collaborationId } = await params;
    const submissions = await listCollaborationSubmissions(
      supabase,
      collaborationId,
    );
    return NextResponse.json({ submissions });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ collaborationId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      streamerName?: unknown;
      liveAccount?: unknown;
      recordingUrl?: unknown;
      note?: unknown;
    };
    const streamerName =
      typeof body.streamerName === "string" ? body.streamerName.trim() : "";
    if (!streamerName) {
      return NextResponse.json(
        { error: "streamerName is required" },
        { status: 400 },
      );
    }

    const { collaborationId } = await params;
    const submission = await submitCollaborationContent({
      repo: new SupabaseCollaborationSubmissionRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      notify: (input) => sendNotification(supabase, input),
      actor: auth,
      input: {
        collaborationId,
        streamerName,
        liveAccount: asText(body.liveAccount),
        recordingUrl: asText(body.recordingUrl),
        note: asText(body.note),
      },
    });

    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
