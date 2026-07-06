// Supabase access token 的本地 HS256 验签（Edge runtime 兼容，只用 WebCrypto
// 与 atob，无 Node 专属依赖）。仓库未引入 jose（pnpm-lock 无该包），Next 内置
// 的 jose 副本不对外暴露，故手写最小验签：签名、exp、sub 三项全过才算通过。
// 任何解析/校验异常一律返回 null，由调用方决定回落路径（middleware 回落到
// supabase.auth.getUser() 的网络校验，保证行为与未配置本地验签时一致）。

export type VerifiedSupabaseJwt = {
  sub: string;
};

export async function verifySupabaseJwt(
  token: string,
  secret: string,
  nowInSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedSupabaseJwt | null> {
  try {
    const [rawHeader, rawPayload, rawSignature] = token.split(".");
    if (!rawHeader || !rawPayload || !rawSignature) {
      return null;
    }

    const header: unknown = JSON.parse(textFromBase64Url(rawHeader));
    if (
      typeof header !== "object" ||
      header === null ||
      (header as { alg?: unknown }).alg !== "HS256"
    ) {
      return null;
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      bytesFromBase64Url(rawSignature),
      encoder.encode(`${rawHeader}.${rawPayload}`),
    );
    if (!signatureValid) {
      return null;
    }

    const payload: unknown = JSON.parse(textFromBase64Url(rawPayload));
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const { exp, sub } = payload as { exp?: unknown; sub?: unknown };
    if (typeof exp !== "number" || exp <= nowInSeconds) {
      return null;
    }
    if (typeof sub !== "string" || sub.length === 0) {
      return null;
    }

    return { sub };
  } catch {
    return null;
  }
}

function bytesFromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function textFromBase64Url(value: string): string {
  return new TextDecoder().decode(bytesFromBase64Url(value));
}
