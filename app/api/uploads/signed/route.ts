import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildPrivateUploadPath,
  createSignedUploadUrl,
} from "@/features/storage/private-upload";
import { getAuthContext } from "@/lib/auth/context";
import {
  getPrivateStorageBucket,
  getRecordingMaxFileBytes,
} from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";

const uploadBodySchema = z.object({
  category: z.enum(["recordings", "report-screenshots"]),
  ownerId: z.string().min(1),
  fileName: z.string().min(1),
  // 可选的申报文件大小：提供且超限时提前 400，省一次注定失败的上传；
  // 不提供不拦（老客户端兼容），真正的强制由桶级 file_size_limit 兜底。
  fileSizeBytes: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseJsonBody(request, uploadBodySchema);

    // 仅录屏类目做尺寸闸门（截图类目不限），与 RECORDING_MAX_FILE_BYTES 对齐。
    const maxFileBytes = getRecordingMaxFileBytes();
    if (
      body.category === "recordings" &&
      body.fileSizeBytes !== undefined &&
      body.fileSizeBytes > maxFileBytes
    ) {
      return NextResponse.json(
        {
          error: `文件超过 ${Math.trunc(maxFileBytes / (1024 * 1024))}MB 上限`,
        },
        { status: 400 },
      );
    }

    const bucket = getPrivateStorageBucket();
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
