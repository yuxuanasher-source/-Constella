import { NextResponse } from "next/server";

import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  updateProjectBasics,
} from "@/features/projects/project-service";
import { withAuth } from "@/lib/http/route-handler";

export const PATCH = withAuth<{ projectId: string }>(
  async ({ supabase, auth, request, params }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      startsAt?: string | null;
      endsAt?: string | null;
      openSignup?: boolean;
      allowDirectInvite?: boolean;
      forceRecording?: boolean;
      forceSystemTiming?: boolean;
    };
    const { projectId } = params;
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
  },
);
