import { NextResponse } from "next/server";

import { SupabaseCollaborationRepository } from "@/features/collaborations/collaboration-repository";
import { acceptCollaboration } from "@/features/collaborations/collaboration-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { sendNotification } from "@/lib/notify/notify";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      inviteCode?: unknown;
    };
    const inviteCode =
      typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
    if (!inviteCode) {
      return NextResponse.json(
        { error: "inviteCode is required" },
        { status: 400 },
      );
    }

    const collaboration = await acceptCollaboration({
      repo: new SupabaseCollaborationRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      notify: (input) => sendNotification(supabase, input),
      actor: auth,
      inviteCode,
    });

    return NextResponse.json({ collaboration }, { status: 201 });
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
