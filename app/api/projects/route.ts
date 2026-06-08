import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { listProjects } from "@/features/projects/project-queries";
import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  createProjectDraft,
} from "@/features/projects/project-service";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projects = await listProjects(supabase);
    return NextResponse.json({ projects: toProjectCardDtos(projects) });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    await assertBillingWriteAllowed({
      client: supabase,
      organizationId: auth.organizationId,
      featureKey: "project_management",
    });

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
  } catch (error) {
    return jsonServiceError(error);
  }
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
