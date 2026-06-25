import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
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
      status?: Parameters<typeof updateProjectBasics>[0]["input"]["status"];
      startsAt?: string | null;
      endsAt?: string | null;
      openSignup?: boolean;
      allowDirectInvite?: boolean;
      forceRecording?: boolean;
      forceSystemTiming?: boolean;
      vendorName?: string | null;
      productName?: string | null;
      agentName?: string | null;
      supplierName?: string | null;
      description?: string | null;
      ownerId?: string | null;
      isPublicToStreamers?: boolean;
      publicSummary?: string | null;
      gameDownloadUrl?: string | null;
      isOpenToMcnCollaboration?: boolean;
      mcnCollaborationSummary?: string | null;
      mcnCollaborationTerms?: Record<string, unknown>;
    };
    const { projectId } = await params;
    await assertBillingWriteAllowed({
      client: supabase,
      organizationId: auth.organizationId,
      featureKey: "project_management",
    });

    const project = await updateProjectBasics({
      repo: new SupabaseProjectRepository(supabase),
      audit: createProjectAuditWriter(supabase),
      actor: auth,
      projectId,
      input: {
        name: body.name?.trim() || undefined,
        status: body.status,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        openSignup: body.openSignup,
        allowDirectInvite: body.allowDirectInvite,
        forceRecording: body.forceRecording,
        forceSystemTiming: body.forceSystemTiming,
        vendorName: normalizeProjectText(body.vendorName),
        productName: normalizeProjectText(body.productName),
        agentName: normalizeProjectText(body.agentName),
        supplierName: normalizeProjectText(body.supplierName),
        description: normalizeProjectText(body.description),
        ownerId: normalizeProjectId(body.ownerId),
        isPublicToStreamers: body.isPublicToStreamers,
        publicSummary: normalizeProjectText(body.publicSummary),
        gameDownloadUrl: normalizeNullableProjectText(body.gameDownloadUrl),
        isOpenToMcnCollaboration: body.isOpenToMcnCollaboration,
        mcnCollaborationSummary: normalizeProjectText(
          body.mcnCollaborationSummary,
        ),
        mcnCollaborationTerms: normalizeProjectTerms(
          body.mcnCollaborationTerms,
        ),
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

function normalizeProjectText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim();
}

function normalizeNullableProjectText(value: string | null | undefined) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim() || null;
}

function normalizeProjectId(value: string | null | undefined) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim() || null;
}

function normalizeProjectTerms(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const keys = Object.keys(value);
  const serialized = JSON.stringify(value);
  if (
    keys.length > 50 ||
    new TextEncoder().encode(serialized).length > 8 * 1024
  ) {
    throw new Error("MCN collaboration terms are too large");
  }

  return value as Record<string, unknown>;
}
