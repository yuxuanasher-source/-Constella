import { NextResponse } from "next/server";

import { assistLiveReviewSchema } from "@/features/live-review/live-review-contracts";
import {
  aggregateReviewKnowledge,
  buildReviewAssist,
} from "@/features/live-review/live-review-knowledge";
import { listLiveReviewDocuments } from "@/features/live-review/live-review-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

// AI 复盘助手：读取组织复盘知识库 → 汇聚知识 → 生成本场辅助建议。
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

    const body = await request.json().catch(() => ({}));
    const input = assistLiveReviewSchema.parse(body ?? {});

    const documents = await listLiveReviewDocuments(
      supabase,
      {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      {
        projectId: input.projectId ?? undefined,
        streamerId: input.streamerId ?? undefined,
        limit: input.limit ?? 100,
      },
    );

    const knowledge = aggregateReviewKnowledge(
      documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        contentMd: doc.contentMd,
        createdAt: doc.createdAt,
      })),
    );

    const assist = buildReviewAssist(knowledge, {
      product: input.product,
      platform: input.platform,
      streamer: input.streamer,
      goal: input.goal,
    });

    return NextResponse.json({ knowledge, assist });
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
