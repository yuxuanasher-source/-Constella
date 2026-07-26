import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

const privateStorageEnvSchema = z.object({
  STORAGE_BUCKET_PRIVATE: z.string().min(1).default("jy-private"),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STORAGE_BUCKET_PRIVATE: privateStorageEnvSchema.shape.STORAGE_BUCKET_PRIVATE,
  ADMISSION_SHARE_CAPABILITY_SECRET: z.string().min(32),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parsePublicEnv(
  env: Record<string, string | undefined>,
): PublicEnv {
  return publicEnvSchema.parse(env);
}

export function parseServerEnv(
  env: Record<string, string | undefined>,
): ServerEnv {
  return serverEnvSchema.parse(env);
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STORAGE_BUCKET_PRIVATE: process.env.STORAGE_BUCKET_PRIVATE,
    ADMISSION_SHARE_CAPABILITY_SECRET:
      process.env.ADMISSION_SHARE_CAPABILITY_SECRET,
  });
}

// 可选：服务端直连 Supabase 的内网地址（如腾讯云上 Kong 的内网口
// http://127.0.0.1:8000）。配置后 SSR / route handler / admin client 的
// Supabase 流量走内网回环，省掉公网域名解析与 TLS 往返；浏览器仍使用
// NEXT_PUBLIC_SUPABASE_URL。两个注意点（见 lib/db/supabase-server.ts 与
// features/storage/private-upload.ts）：
//   1. auth cookie 名必须固定为按公网地址推导的默认名，否则与浏览器写入的
//      cookie 对不上，会话直接失效；
//   2. storage 签名 URL 会带上签名时 client 的 origin，返回给浏览器前必须
//      换回公网 origin。
// 值缺失或非法（非 URL）时返回 null，调用方回落公网地址。
export function getSupabaseInternalUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.SUPABASE_INTERNAL_URL;
  if (!raw) {
    return null;
  }
  const parsed = z.url().safeParse(raw);
  if (!parsed.success) {
    console.warn(
      "[env] SUPABASE_INTERNAL_URL is not a valid URL; falling back to NEXT_PUBLIC_SUPABASE_URL",
    );
    return null;
  }
  return parsed.data;
}

export function getPrivateStorageBucket(
  env: Record<string, string | undefined> = process.env,
) {
  return privateStorageEnvSchema.parse({
    STORAGE_BUCKET_PRIVATE: env.STORAGE_BUCKET_PRIVATE,
  }).STORAGE_BUCKET_PRIVATE;
}

// 录屏解析资源闸门（阶段0 整改 R6/R7）：
// - RECORDING_MAX_DURATION_MINUTES：录屏时长上限（分钟），默认 15；
// - RECORDING_MAX_FILE_BYTES：录屏原始文件大小上限（字节），默认 314572800（300MB）。
// 超限文件在上传侧被 400 拒绝、解析侧抛中文错误走既有降级链路；
// 非法/缺失的 env 值一律回退默认值，不让配置错误放大闸门。
const DEFAULT_RECORDING_MAX_DURATION_MINUTES = 15;
const DEFAULT_RECORDING_MAX_FILE_BYTES = 314572800;

export function getRecordingMaxDurationMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  return parsePositiveNumber(
    env.RECORDING_MAX_DURATION_MINUTES,
    DEFAULT_RECORDING_MAX_DURATION_MINUTES,
  );
}

export function getRecordingMaxFileBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  return parsePositiveNumber(
    env.RECORDING_MAX_FILE_BYTES,
    DEFAULT_RECORDING_MAX_FILE_BYTES,
  );
}

function parsePositiveNumber(
  raw: string | undefined,
  fallback: number,
): number {
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// 录屏 AI 解析月度配额（阶段0 整改 R8）：每组织每自然月可发起的解析条数上限，
// 打满后入队请求直接 429（下月自动恢复）。默认 100，可用
// RECORDING_AI_MONTHLY_QUOTA 覆盖；非法/缺失值回退默认值，
// 不让配置错误意外放大或收紧配额。
const DEFAULT_RECORDING_AI_MONTHLY_QUOTA = 100;

export function getRecordingAiMonthlyQuota(
  env: Record<string, string | undefined> = process.env,
): number {
  return parsePositiveInteger(
    env.RECORDING_AI_MONTHLY_QUOTA,
    DEFAULT_RECORDING_AI_MONTHLY_QUOTA,
  );
}

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
): number {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export type TencentCosConfig = {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
};

// 腾讯云 COS 配置。复用 OCR 已有的 TENCENT_SECRET_ID / TENCENT_SECRET_KEY；
// 桶名与地域默认指向本项目的 jy-private-1322741645 / ap-guangzhou，可用
// TENCENT_COS_BUCKET / TENCENT_COS_REGION 覆盖。只要密钥就绪即自动启用。
const DEFAULT_COS_BUCKET = "jy-private-1322741645";
const DEFAULT_COS_REGION = "ap-guangzhou";

export function getTencentCosConfig(
  env: Record<string, string | undefined> = process.env,
): TencentCosConfig | null {
  const secretId = env.TENCENT_COS_SECRET_ID || env.TENCENT_SECRET_ID;
  const secretKey = env.TENCENT_COS_SECRET_KEY || env.TENCENT_SECRET_KEY;
  const bucket = env.TENCENT_COS_BUCKET || DEFAULT_COS_BUCKET;
  const region =
    env.TENCENT_COS_REGION || env.TENCENT_OCR_REGION || DEFAULT_COS_REGION;
  if (!secretId || !secretKey || !bucket) return null;
  return { secretId, secretKey, bucket, region };
}
