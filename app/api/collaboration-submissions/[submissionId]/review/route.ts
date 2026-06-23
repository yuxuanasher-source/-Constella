import { NextResponse } from "next/server";

import { SupabaseCollaborationSubmissionRepository } from "@/features/collaborations/collaboration-repository";
import {
  reviewCollaborationSubmission,
  type ReviewDecision,
} from "@/features/collaborations/collaboration-submission-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { sendNotification } from "@/lib/notify/notify";
import { statusForServiceError } from "@/lib/http/route-error-status";

const VALID_DECISIONS = new Set<ReviewDecision>([
  "under_review",
  "approved",
  "rejected",
  "needs_changes",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      decision?: unknown;
      reviewNote?: unknown;
    };
    const decision =
      typeof body.decision === "string" ? body.decision.trim() : "";
    if (!VALID_DECISIONS.has(decision as ReviewDecision)) {
      return NextResponse.json(
        {
          error:
            "decision must be under_review, approved, rejected, or needs_changes",
        },
        { status: 400 },
      );
    }

    const { submissionId } = await params;
    const submission = await reviewCollaborationSubmission({
      repo: new SupabaseCollaborationSubmissionRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      notify: (input) => sendNotification(supabase, input),
      actor: auth,
      submissionId,
      decision: decision as ReviewDecision,
      reviewNote:
        typeof body.reviewNote === "string" ? body.reviewNote : undefined,
    });

    return NextResponse.json({ submission });
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
