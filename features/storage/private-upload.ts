import type { SupabaseClient } from "@supabase/supabase-js";

export type UploadCategory = "recordings" | "report-screenshots";

export function buildPrivateUploadPath(input: {
  organizationId: string;
  category: UploadCategory;
  ownerId: string;
  fileName: string;
}) {
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${input.organizationId}/${input.category}/${input.ownerId}/${safeFileName}`;
}

export async function createSignedUploadUrl(input: {
  client: SupabaseClient;
  bucket: string;
  path: string;
}) {
  const { data, error } = await input.client.storage
    .from(input.bucket)
    .createSignedUploadUrl(input.path);

  if (error) {
    throw error;
  }

  return data;
}
