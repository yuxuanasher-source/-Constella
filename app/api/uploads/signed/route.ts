import { NextResponse } from "next/server";

import {
  buildPrivateUploadPath,
  createSignedUploadUrl,
  type UploadCategory,
} from "@/features/storage/private-upload";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const defaultBucket = "evidence-private";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      category?: UploadCategory;
      ownerId?: string;
      fileName?: string;
    };
    if (!body.category || !body.ownerId || !body.fileName) {
      return NextResponse.json(
        { error: "category, ownerId and fileName are required" },
        { status: 400 },
      );
    }

    const bucket = process.env.SUPABASE_PRIVATE_BUCKET ?? defaultBucket;
    const path = buildPrivateUploadPath({
      organizationId: auth.organizationId,
      category: body.category,
      ownerId: body.ownerId,
      fileName: body.fileName,
    });
    const signed = await createSignedUploadUrl({
      client: supabase,
      bucket,
      path,
    });

    return NextResponse.json({
      bucket,
      path,
      signedUrl: signed.signedUrl,
      token: signed.token,
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
