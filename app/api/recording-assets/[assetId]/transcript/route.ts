import { NextResponse } from "next/server";

import {
  buildAnnotatedTranscript,
  loadRecordingTranscriptContext,
} from "@/features/recordings/recording-transcript";
import { buildTranscriptWordInsights } from "@/features/recordings/transcript-word-insights";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

/**
 * GET /api/recording-assets/[assetId]/transcript
 * 带风险词标注的直播录屏逐字稿：取该资产最新 succeeded 且带转写的分析，
 * 用录屏风险词典（high → violation / medium → warning）切 segments。
 * 无转写时返回 200 + { transcript: { available: false } }（不是 404，
 * 资产不存在 / 不属于本组织才是 404）。
 */
export async function GET(_request: Request, context: RouteContext) {
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
        { error: "Only MCN staff can view recording transcripts" },
        { status: 403 },
      );
    }

    const { assetId } = await context.params;
    const { asset, transcript } = await loadRecordingTranscriptContext({
      client: supabase as never,
      organizationId: auth.organizationId,
      assetId,
    });

    if (!asset) {
      return NextResponse.json(
        { error: "Recording asset not found" },
        { status: 404 },
      );
    }

    if (!transcript) {
      return NextResponse.json({ transcript: { available: false } });
    }

    const annotated = buildAnnotatedTranscript({
      utterances: transcript.utterances,
    });

    return NextResponse.json({
      transcript: {
        available: true,
        asrProvider: transcript.asrProvider,
        analysisId: transcript.analysisId,
        utterances: annotated.utterances,
        summary: annotated.summary,
        // 高频词洞察：确定性词频统计（available:false 时不携带该字段）。
        wordInsights: buildTranscriptWordInsights({
          utterances: transcript.utterances,
        }),
      },
    });
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
