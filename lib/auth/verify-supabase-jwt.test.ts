import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifySupabaseJwt } from "./verify-supabase-jwt";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters";
const NOW = 1_750_000_000;

function base64Url(value: object | string): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(raw).toString("base64url");
}

function signToken(
  payload: object,
  { secret = SECRET, header = { alg: "HS256", typ: "JWT" } } = {},
): string {
  const head = base64Url(header);
  const body = base64Url(payload);
  const signature = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${signature}`;
}

describe("verifySupabaseJwt", () => {
  it("accepts a correctly signed unexpired token with a subject", async () => {
    const token = signToken({ sub: "user-1", exp: NOW + 3600 });

    await expect(verifySupabaseJwt(token, SECRET, NOW)).resolves.toEqual({
      sub: "user-1",
    });
  });

  it("rejects an expired token", async () => {
    const token = signToken({ sub: "user-1", exp: NOW - 1 });

    await expect(verifySupabaseJwt(token, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = signToken(
      { sub: "user-1", exp: NOW + 3600 },
      { secret: "another-secret-entirely-with-enough-length" },
    );

    await expect(verifySupabaseJwt(token, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = signToken({ sub: "user-1", exp: NOW + 3600 });
    const [head, , signature] = token.split(".");
    const forged = `${head}.${base64Url({ sub: "user-2", exp: NOW + 3600 })}.${signature}`;

    await expect(verifySupabaseJwt(forged, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects tokens without a subject or without an exp", async () => {
    await expect(
      verifySupabaseJwt(signToken({ exp: NOW + 3600 }), SECRET, NOW),
    ).resolves.toBeNull();
    await expect(
      verifySupabaseJwt(signToken({ sub: "user-1" }), SECRET, NOW),
    ).resolves.toBeNull();
    await expect(
      verifySupabaseJwt(
        signToken({ sub: "", exp: NOW + 3600 }),
        SECRET,
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it("rejects non-HS256 algorithms, including alg=none", async () => {
    const noneToken = `${base64Url({ alg: "none" })}.${base64Url({
      sub: "user-1",
      exp: NOW + 3600,
    })}.`;
    await expect(verifySupabaseJwt(noneToken, SECRET, NOW)).resolves.toBeNull();

    const rsToken = signToken(
      { sub: "user-1", exp: NOW + 3600 },
      { header: { alg: "RS256", typ: "JWT" } },
    );
    await expect(verifySupabaseJwt(rsToken, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects garbage tokens without throwing", async () => {
    await expect(verifySupabaseJwt("", SECRET, NOW)).resolves.toBeNull();
    await expect(verifySupabaseJwt("abc", SECRET, NOW)).resolves.toBeNull();
    await expect(
      verifySupabaseJwt("a.b.c", SECRET, NOW),
    ).resolves.toBeNull();
  });
});
