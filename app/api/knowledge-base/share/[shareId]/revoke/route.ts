import { NextResponse } from "next/server";

import {
  canManageKnowledgeShares,
  createKnowledgeShareRepository,
  revokeKnowledgeShare,
} from "@/features/knowledge-base/knowledge-share";
import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { cosDeleteObject } from "@/lib/storage/tencent-cos";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  context: { params: Promise<{ shareId: string }> },
) {
  try {
    const sessionClient = await createSupabaseServerClient();
    const auth = sessionClient ? await getAuthContext(sessionClient) : null;
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageKnowledgeShares(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Sharing unavailable" },
        { status: 503 },
      );
    }

    const { shareId } = await context.params;
    if (!UUID_PATTERN.test(shareId)) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    const result = await revokeKnowledgeShare(
      {
        id: shareId,
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
      },
      {
        repository: createKnowledgeShareRepository(admin),
        deleteSnapshot: cosDeleteObject,
        onCleanupFailure: ({ shareId: failedShareId }) => {
          console.error("Knowledge share COS cleanup failed", {
            shareId: failedShareId,
          });
        },
      },
    );
    if (!result) {
      return NextResponse.json(
        { error: "Share not found" },
        { status: 404 },
      );
    }
    await writeAuditLog(admin, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: "revoke_knowledge_share",
      module: "knowledge_base",
      objectType: "knowledge_share_link",
      objectId: result.id,
      after: { revoked: true, cleanupPending: result.cleanupPending },
      isHighRisk: true,
      reason: "knowledge_share_revocation",
    }).catch(() => {
      console.error("Knowledge share audit failed", {
        shareId: result.id,
        phase: "revoke",
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to revoke share" },
      { status: 500 },
    );
  }
}
