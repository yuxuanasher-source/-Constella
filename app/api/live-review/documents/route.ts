import { NextResponse } from "next/server";

import {
  listLiveReviewQuerySchema,
  saveLiveReviewSchema,
} from "@/features/live-review/live-review-contracts";
import {
  listLiveReviewDocuments,
  saveLiveReviewDocument,
} from "@/features/live-review/live-review-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = listLiveReviewQuerySchema.parse({
      projectId: searchParams.get("projectId") ?? undefined,
      streamerId: searchParams.get("streamerId") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    const documents = await listLiveReviewDocuments(
      supabase,
      {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      query,
    );

    return NextResponse.json({ documents });
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

    const body = await request.json();
    const input = saveLiveReviewSchema.parse(body);

    const document = await saveLiveReviewDocument(
      supabase,
      {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      input,
    );

    return NextResponse.json({ document }, { status: 201 });
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
