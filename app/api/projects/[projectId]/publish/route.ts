import { NextResponse } from "next/server";

import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  publishProject,
} from "@/features/projects/project-service";
import { withAuth } from "@/lib/http/route-handler";

export const POST = withAuth<{ projectId: string }>(
  async ({ supabase, auth, params }) => {
    const { projectId } = params;
    const project = await publishProject({
      repo: new SupabaseProjectRepository(supabase),
      audit: createProjectAuditWriter(supabase),
      actor: auth,
      projectId,
    });

    return NextResponse.json({ project });
  },
);
