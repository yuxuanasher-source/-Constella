import { NextResponse } from "next/server";

import { listProjects } from "@/features/projects/project-queries";
import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  createProjectDraft,
} from "@/features/projects/project-service";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import { withAuth } from "@/lib/http/route-handler";

export const GET = withAuth(async ({ supabase }) => {
  const projects = await listProjects(supabase);
  return NextResponse.json({ projects: toProjectCardDtos(projects) });
});

export const POST = withAuth(async ({ supabase, auth, request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    code?: string;
    supplierId?: string;
  };
  const name = body.name?.trim();
  const code = body.code?.trim();
  if (!name || !code) {
    return NextResponse.json(
      { error: "name and code are required" },
      { status: 400 },
    );
  }

  const project = await createProjectDraft({
    repo: new SupabaseProjectRepository(supabase),
    audit: createProjectAuditWriter(supabase),
    actor: auth,
    input: {
      name,
      code,
      supplierId: body.supplierId?.trim() || undefined,
    },
  });

  return NextResponse.json({ project }, { status: 201 });
});
