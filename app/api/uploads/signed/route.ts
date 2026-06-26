import { NextResponse } from "next/server";

import {
  buildPrivateUploadPath,
  createSignedUploadUrl,
  type UploadCategory,
} from "@/features/storage/private-upload";
import { withAuth } from "@/lib/http/route-handler";

const defaultBucket = "evidence-private";

export const POST = withAuth(async ({ supabase, auth, request }) => {
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
});
