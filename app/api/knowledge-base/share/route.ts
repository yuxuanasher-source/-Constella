import { NextResponse } from "next/server";

import {
  DuplicateKnowledgeShareRequestError,
  InvalidKnowledgeShareInputError,
  KnowledgeShareCreationError,
  canManageKnowledgeShares,
  createKnowledgeShare,
  createKnowledgeShareRepository,
  listActiveKnowledgeShares,
} from "@/features/knowledge-base/knowledge-share";
import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { getPublicEnv } from "@/lib/config/env";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import {
  cosDeleteObject,
  cosPutJson,
  isCosConfigured,
} from "@/lib/storage/tencent-cos";

const ALLOWED_EXPIRY_DAYS = new Set([1, 7, 30]);

async function resolveAuthorizedContext() {
  const sessionClient = await createSupabaseServerClient();
  const auth = sessionClient ? await getAuthContext(sessionClient) : null;
  if (!auth) return { error: "unauthorized" as const };
  if (!canManageKnowledgeShares(auth.role)) {
    return { error: "forbidden" as const };
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "unavailable" as const };
  return { auth, admin };
}

export async function GET(request: Request) {
  try {
    const context = await resolveAuthorizedContext();
    if ("error" in context && context.error) {
      return contextError(context.error);
    }

    const sourceDocumentId = new URL(request.url).searchParams.get(
      "sourceDocumentId",
    );
    const shares = await listActiveKnowledgeShares(
      {
        organizationId: context.auth.organizationId,
        ...(sourceDocumentId ? { sourceDocumentId } : null),
      },
      { repository: createKnowledgeShareRepository(context.admin) },
    );
    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof InvalidKnowledgeShareInputError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to list shares" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveAuthorizedContext();
    if ("error" in context && context.error) {
      return contextError(context.error);
    }
    if (!isCosConfigured()) {
      return NextResponse.json(
        { error: "Sharing unavailable" },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const expiresInDays =
      "expiresInDays" in body ? body.expiresInDays : 7;
    if (
      typeof expiresInDays !== "number" ||
      !ALLOWED_EXPIRY_DAYS.has(expiresInDays)
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const requestKey = request.headers.get("idempotency-key");
    if (!requestKey || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const publicBaseUrl = getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    const result = await createKnowledgeShare(
      {
        organizationId: context.auth.organizationId,
        actorUserId: context.auth.userId,
        actorName: context.auth.name || context.auth.email,
        title: "title" in body ? body.title : "",
        contentMd: "contentMd" in body ? body.contentMd : "",
        sourceDocumentId:
          "sourceDocumentId" in body ? body.sourceDocumentId : undefined,
        requestKey,
        expiresInDays,
      } as Parameters<typeof createKnowledgeShare>[0],
      {
        repository: createKnowledgeShareRepository(context.admin),
        putSnapshot: cosPutJson,
        deleteSnapshot: cosDeleteObject,
      },
    );
    await writeAuditLog(context.admin, {
      organizationId: context.auth.organizationId,
      actorUserId: context.auth.userId,
      actorName: context.auth.name,
      actorRole: context.auth.role,
      action: "create_knowledge_share",
      module: "knowledge_base",
      objectType: "knowledge_share_link",
      objectId: result.id,
      objectName: "title" in body ? String(body.title).slice(0, 200) : undefined,
      after: {
        expiresAt: result.expiresAt,
        sourceDocumentId:
          "sourceDocumentId" in body && typeof body.sourceDocumentId === "string"
            ? body.sourceDocumentId
            : null,
      },
    }).catch(() => {
      console.error("Knowledge share audit failed", {
        shareId: result.id,
        phase: "create",
      });
    });

    return NextResponse.json({
      id: result.id,
      url: `${publicBaseUrl}/share/kb/${result.token}`,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    if (error instanceof InvalidKnowledgeShareInputError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (error instanceof DuplicateKnowledgeShareRequestError) {
      return NextResponse.json(
        { error: "Share request already processed" },
        { status: 409 },
      );
    }
    if (error instanceof KnowledgeShareCreationError) {
      return NextResponse.json(
        { error: "Unable to create share" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Unable to create share" },
      { status: 500 },
    );
  }
}

function contextError(error: "unauthorized" | "forbidden" | "unavailable") {
  if (error === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Sharing unavailable" },
    { status: 503 },
  );
}
