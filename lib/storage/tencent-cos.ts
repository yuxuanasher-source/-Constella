import COS from "cos-nodejs-sdk-v5";

import { getTencentCosConfig, type TencentCosConfig } from "@/lib/config/env";

// 腾讯云 COS 轻封装：读/写 JSON 对象。未配置 COS 时返回 isConfigured=false，
// 调用方据此优雅降级（前端回退本地缓存）。

let cachedClient: COS | null = null;
let cachedConfig: TencentCosConfig | null = null;

function getClient(): { cos: COS; config: TencentCosConfig } | null {
  const config = getTencentCosConfig();
  if (!config) return null;
  if (!cachedClient || cachedConfig?.secretId !== config.secretId) {
    cachedClient = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });
    cachedConfig = config;
  }
  return { cos: cachedClient, config };
}

export function isCosConfigured(): boolean {
  return getTencentCosConfig() != null;
}

export async function cosGetJson<T = unknown>(key: string): Promise<T | null> {
  const ctx = getClient();
  if (!ctx) return null;
  const { cos, config } = ctx;
  try {
    const result = await cos.getObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
    });
    const body = result.Body;
    const text = Buffer.isBuffer(body)
      ? body.toString("utf8")
      : typeof body === "string"
        ? body
        : Buffer.from(body as ArrayBuffer).toString("utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    // 404 / NoSuchKey → 尚未创建，返回 null 让调用方使用默认值。
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404) return null;
    const code = (error as { code?: string })?.code;
    if (code === "NoSuchKey" || code === "NotFound") return null;
    throw error;
  }
}

export async function cosPutJson(key: string, value: unknown): Promise<void> {
  const ctx = getClient();
  if (!ctx) throw new Error("Tencent COS is not configured");
  const { cos, config } = ctx;
  await cos.putObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Body: Buffer.from(JSON.stringify(value), "utf8"),
    ContentType: "application/json",
  });
}
