import { NextResponse } from "next/server";

import {
  getRecordingIntelligenceReport,
  runRecordingIntelligence,
  type RecordingIntelligenceInput,
} from "@/features/recordings/recording-intelligence";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
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
        { error: "Only MCN staff can run recording intelligence analysis" },
        { status: 403 },
      );
    }

    const { assetId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      transcript?: unknown;
      operationEvents?: unknown;
      signals?: unknown;
    };

    const report = await runRecordingIntelligence({
      client: supabase as never,
      actor: auth,
      assetId,
      input: {
        transcript: Array.isArray(body.transcript)
          ? (body.transcript as RecordingIntelligenceInput["transcript"])
          : undefined,
        operationEvents: Array.isArray(body.operationEvents)
          ? (body.operationEvents as RecordingIntelligenceInput["operationEvents"])
          : undefined,
        signals:
          body.signals && typeof body.signals === "object"
            ? (body.signals as RecordingIntelligenceInput["signals"])
            : undefined,
      },
    });

    return NextResponse.json({ report }, { status: 201 });
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

    const { assetId } = await context.params;
    const snapshot = await getRecordingIntelligenceReport({
      client: supabase as never,
      actor: auth,
      assetId,
    });

    return NextResponse.json({ snapshot });
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
