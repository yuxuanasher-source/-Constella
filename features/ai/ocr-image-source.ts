import type { SupabaseClient } from "@supabase/supabase-js";

import type { OcrJobPayload } from "./ocr-jobs";
import type { TencentOcrInput } from "./providers/tencent-ocr-provider";

export async function resolveOcrImageInput({
  client,
  payload,
  defaultBucket,
}: {
  client: Pick<SupabaseClient, "storage">;
  payload: Pick<
    OcrJobPayload,
    "imageBase64" | "imageUrl" | "imageBucket" | "imagePath" | "liveReportId"
  >;
  defaultBucket: string;
}): Promise<TencentOcrInput> {
  if (payload.imageUrl) {
    return { imageUrl: payload.imageUrl };
  }

  if (payload.imageBase64) {
    return { imageBase64: payload.imageBase64 };
  }

  if (!payload.imagePath) {
    throw new Error("OCR job requires imageBase64, imageUrl, or imagePath");
  }

  const bucket = payload.imageBucket || defaultBucket;
  const { data, error } = await client.storage
    .from(bucket)
    .download(payload.imagePath);
  if (!data) {
    throw new Error("OCR image object was not found");
  }
  if (error) {
    throw error;
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  return { imageBase64: bytes.toString("base64") };
}
