import { NextResponse } from "next/server";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import type { KnowledgeClient } from "@/features/ai/knowledge-repository";
import { createWebSearchProviderFromEnv } from "@/features/ai/web-search-provider";
import { loadStreamerProjectMarketReferences } from "@/features/streamers/streamer-project-market-references";
import { loadStreamerProjectReviewInput } from "@/features/streamers/streamer-project-review-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run streamer project review" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      streamerId?: unknown;
      projectId?: unknown;
      externalReferences?: unknown;
    };
    const streamerId =
      typeof body.streamerId === "string" ? body.streamerId.trim() : "";
    const projectId =
      typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!streamerId || !projectId) {
      return NextResponse.json(
        { error: "Streamer and project are required" },
        { status: 400 },
      );
    }

    const profileInput = await loadStreamerProjectReviewInput({
      supabase,
      organizationId: auth.organizationId,
      streamerId,
      projectId,
    });
    const externalReferences = sanitizeExternalReferences(body.externalReferences);
    const marketReferences =
      externalReferences.length > 0
        ? []
        : await loadStreamerProjectMarketReferences({
            client: supabase as unknown as KnowledgeClient,
            organizationId: auth.organizationId,
            profileInput,
            webSearchProvider: createWebSearchProviderFromEnv(),
          });
    const mergedExternalReferences =
      externalReferences.length > 0 ? externalReferences : marketReferences;
    const reviewProfileInput =
      mergedExternalReferences.length > 0
        ? { ...profileInput, externalReferences: mergedExternalReferences }
        : profileInput;
    const result = await runAiToolQuery({
      client: supabase,
      actor: {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      toolName: "streamer_project_review",
      input: { profileInput: reviewProfileInput },
    });

    return NextResponse.json({ result, profileInput: reviewProfileInput });
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

function sanitizeExternalReferences(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = stringValue(item.id);
      const title = stringValue(item.title);
      const sourceName = stringValue(item.sourceName);
      const retrievedAt = stringValue(item.retrievedAt);
      const summary = stringValue(item.summary);
      if (!id || !title || !sourceName || !retrievedAt || !summary) return null;
      return {
        id,
        title,
        sourceName,
        sourceUrl: stringValue(item.sourceUrl),
        retrievedAt,
        summary,
        productType: stringValue(item.productType),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
