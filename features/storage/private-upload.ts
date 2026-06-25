import type { SupabaseClient } from "@supabase/supabase-js";

export type UploadCategory = "recordings" | "report-screenshots";

const allowedUploadCategories = [
  "recordings",
  "report-screenshots",
] as const satisfies readonly UploadCategory[];

export function buildPrivateUploadPath(input: {
  organizationId: string;
  category: UploadCategory;
  ownerId: string;
  fileName: string;
}) {
  const organizationId = cleanPathSegment(input.organizationId);
  const category = cleanUploadCategory(input.category);
  const ownerId = cleanPathSegment(input.ownerId);
  const safeFileName = cleanFileName(input.fileName);

  return `${organizationId}/${category}/${ownerId}/${safeFileName}`;
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

export async function createSignedDownloadUrl(input: {
  client: SupabaseClient;
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}) {
  const { data, error } = await input.client.storage
    .from(input.bucket)
    .createSignedUrl(input.path, input.expiresInSeconds ?? 3600);

  if (error) {
    throw error;
  }

  return data;
}

function cleanUploadCategory(category: UploadCategory): UploadCategory {
  if (
    !allowedUploadCategories.includes(category as UploadCategory) ||
    category.includes("/") ||
    category.includes("\\")
  ) {
    throw new Error("Invalid upload category");
  }

  return category;
}

function cleanPathSegment(segment: string): string {
  const value = segment.trim();
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new Error("Invalid upload path segment");
  }

  return value;
}

function cleanFileName(fileName: string): string {
  const safeFileName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safeFileName || safeFileName === "." || safeFileName === "..") {
    throw new Error("Invalid upload file name");
  }

  return safeFileName;
}
