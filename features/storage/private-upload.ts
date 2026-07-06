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

// 服务端可能经 SUPABASE_INTERNAL_URL（内网回环）连 Supabase，storage-js 生成
// 的签名 URL 会带内网 origin。签名 URL 是交给浏览器直接访问的，必须把 origin
// 换回公网 NEXT_PUBLIC_SUPABASE_URL；路径与签名参数原样保留（Supabase 的
// storage 签名只覆盖 path + token，与 host 无关，内外网口指向同一 Kong）。
// 未配置内网地址、origin 相同或 URL 不是内网前缀时原样返回。
export function toPublicSignedUrl(
  signedUrl: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const internalRaw = env.SUPABASE_INTERNAL_URL;
  const publicRaw = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!internalRaw || !publicRaw) {
    return signedUrl;
  }

  let internalOrigin: string;
  let publicOrigin: string;
  try {
    internalOrigin = new URL(internalRaw).origin;
    publicOrigin = new URL(publicRaw).origin;
  } catch {
    return signedUrl;
  }

  if (internalOrigin === publicOrigin) {
    return signedUrl;
  }
  if (!signedUrl.startsWith(`${internalOrigin}/`)) {
    return signedUrl;
  }

  return `${publicOrigin}${signedUrl.slice(internalOrigin.length)}`;
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

  return { ...data, signedUrl: toPublicSignedUrl(data.signedUrl) };
}

export async function createSignedDownloadUrl(input: {
  // 只依赖 storage 子集，服务端调用方（如录屏音频抽取）可传窄类型 client。
  client: Pick<SupabaseClient, "storage">;
  bucket: string;
  path: string;
  expiresInSeconds?: number;
  // 服务端自用下载（如录屏音频抽取的流式拉片）应保留内网 origin：
  // 配置了 SUPABASE_INTERNAL_URL 时走本机回环，不要改写成公网地址。
  // 交给浏览器的签名 URL（默认）必须改写为公网 origin。
  keepInternalOrigin?: boolean;
}) {
  const { data, error } = await input.client.storage
    .from(input.bucket)
    .createSignedUrl(input.path, input.expiresInSeconds ?? 3600);

  if (error) {
    throw error;
  }
  if (!data?.signedUrl) {
    // 存储层未返回签名 URL（对象缺失等）：原样透传，调用方各自兜底。
    return data;
  }

  return {
    ...data,
    signedUrl: input.keepInternalOrigin
      ? data.signedUrl
      : toPublicSignedUrl(data.signedUrl),
  };
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
