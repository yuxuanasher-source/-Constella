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
// The decoded Markdown limit is 8 MiB. The wire envelope gets 1 MiB of JSON
// overhead, while escaped payloads that exceed this independent cap fail fast.
export const MAX_KNOWLEDGE_SHARE_REQUEST_BYTES = 9 * 1024 * 1024;

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

    const parsedBody = await readJsonBodyWithLimit(request);
    if (parsedBody.kind === "too_large") {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const body = parsedBody.kind === "ok" ? parsedBody.value : null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const expiresInDays = "expiresInDays" in body ? body.expiresInDays : 7;
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
        onCompensationFailure: async ({ shareId, failedStages }) => {
          console.error("Knowledge share compensation requires manual review", {
            shareId,
            failedStages,
          });
          await writeAuditLog(context.admin, {
            organizationId: context.auth.organizationId,
            actorUserId: context.auth.userId,
            actorName: context.auth.name,
            actorRole: context.auth.role,
            action: "create_knowledge_share",
            module: "knowledge_base",
            objectType: "knowledge_share_link",
            objectId: shareId,
            after: { failedStages, manualReviewRequired: true },
            reason: "knowledge_share_compensation_manual_review",
            isHighRisk: true,
            result: "failure",
          }).catch(() => {
            console.error("Knowledge share compensation audit failed", {
              shareId,
              failedStages,
            });
          });
        },
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
      objectName:
        "title" in body ? String(body.title).slice(0, 200) : undefined,
      after: {
        expiresAt: result.expiresAt,
        sourceDocumentId:
          "sourceDocumentId" in body &&
          typeof body.sourceDocumentId === "string"
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
        {
          code: "share_request_already_processed",
          shareId: error.existingShareId,
          shareStatus: error.shareStatus,
        },
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

type LimitedJsonResult =
  | { kind: "ok"; value: unknown }
  | { kind: "invalid" }
  | { kind: "too_large" };

async function readJsonBodyWithLimit(
  request: Request,
): Promise<LimitedJsonResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MAX_KNOWLEDGE_SHARE_REQUEST_BYTES) {
      await request.body?.cancel().catch(() => undefined);
      return { kind: "too_large" };
    }
  }
  if (!request.body) return { kind: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_KNOWLEDGE_SHARE_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "invalid" };
  }
}

function contextError(error: "unauthorized" | "forbidden" | "unavailable") {
  if (error === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: "Sharing unavailable" }, { status: 503 });
}
