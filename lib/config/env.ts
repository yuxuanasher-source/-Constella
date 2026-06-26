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
  });
}

export function getPrivateStorageBucket(
  env: Record<string, string | undefined> = process.env,
) {
  return privateStorageEnvSchema.parse({
    STORAGE_BUCKET_PRIVATE: env.STORAGE_BUCKET_PRIVATE,
  }).STORAGE_BUCKET_PRIVATE;
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
