import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildPrivateUploadPath,
  createSignedUploadUrl,
} from "@/features/storage/private-upload";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";

const defaultBucket = "evidence-private";

const uploadBodySchema = z.object({
  category: z.enum(["recordings", "report-screenshots"]),
  ownerId: z.string().min(1),
  fileName: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseJsonBody(request, uploadBodySchema);

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
    const httpError = toHttpError(error);
    return NextResponse.json(
      { error: httpError.message },
      { status: httpError.status },
    );
  }
}
