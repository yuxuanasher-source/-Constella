import { NextResponse } from "next/server";

import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  updateProjectBasics,
} from "@/features/projects/project-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      startsAt?: string | null;
      endsAt?: string | null;
      openSignup?: boolean;
      allowDirectInvite?: boolean;
      forceRecording?: boolean;
      forceSystemTiming?: boolean;
    };
    const { projectId } = await params;
    const project = await updateProjectBasics({
      repo: new SupabaseProjectRepository(supabase),
      audit: createProjectAuditWriter(supabase),
      actor: auth,
      projectId,
      input: {
        name: body.name?.trim() || undefined,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        openSignup: body.openSignup,
        allowDirectInvite: body.allowDirectInvite,
        forceRecording: body.forceRecording,
        forceSystemTiming: body.forceSystemTiming,
      },
    });

    return NextResponse.json({ project });
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
