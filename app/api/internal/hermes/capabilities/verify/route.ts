import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { isSha256, isUuid } from "@/features/ai/hermes/contracts";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RPC_NAME = "verify_ai_hermes_invocation_capability";
const RPC_RESULT_KEYS = [
  "actor_fingerprint",
  "conversation_id",
  "expires_at",
  "invocation_id",
  "organization_id",
  "owner_user_id",
  "revoked_at",
] as const;

type RpcResult = {
  data?: unknown | null;
  error?: unknown | null;
};

type HermesCapabilityVerificationClient = {
  rpc: (
    name: typeof RPC_NAME,
    args: { p_token_sha256: string },
  ) => Promise<RpcResult>;
};

export type HermesCapabilityVerificationResult = {
  organizationId: string;
  ownerUserId: string;
  conversationId: string;
  invocationId: string;
  actorFingerprint: string;
  expiresAt: string;
  revokedAt: null;
};

type VerificationService = (input: {
  capabilityToken: string;
}) => Promise<HermesCapabilityVerificationResult | null>;

type VerificationErrorCode = "capability_invalid" | "persistence_unavailable";

export class HermesCapabilityVerificationError extends Error {
  constructor(readonly code: VerificationErrorCode) {
    super(code);
    this.name = "HermesCapabilityVerificationError";
  }
}

export function createHermesCapabilityVerifyHandler({
  verify,
}: {
  verify: VerificationService;
}) {
  return async function handleHermesCapabilityVerify(
    request: Request,
  ): Promise<Response> {
    const capabilityToken = bearerCapability(request);
    if (!capabilityToken) {
      return json({ error: { code: "unauthorized" } }, 401);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      return json({ error: { code: "unsupported_media_type" } }, 415);
    }

    const body = await request.json().catch(() => null);
    if (!isExactEmptyObject(body)) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const capability = await verify({ capabilityToken });
      if (!capability) {
        return json({ error: { code: "capability_not_found" } }, 404);
      }
      return json({ capability }, 200);
    } catch (error) {
      if (error instanceof HermesCapabilityVerificationError) {
        return json(
          { error: { code: error.code } },
          error.code === "capability_invalid" ? 403 : 503,
        );
      }
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

const defaultHandler = createHermesCapabilityVerifyHandler({
  verify: verifyWithAdminClient,
});

export async function POST(request: Request): Promise<Response> {
  return defaultHandler(request);
}

async function verifyWithAdminClient(input: {
  capabilityToken: string;
}): Promise<HermesCapabilityVerificationResult | null> {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }
  return verifyHermesCapabilityWithProductPersistence({
    client: client as unknown as HermesCapabilityVerificationClient,
    capabilityToken: input.capabilityToken,
  });
}

export async function verifyHermesCapabilityWithProductPersistence({
  client,
  capabilityToken,
  now = new Date(),
}: {
  client: HermesCapabilityVerificationClient;
  capabilityToken: string;
  now?: Date;
}): Promise<HermesCapabilityVerificationResult | null> {
  let rpcResult: RpcResult;
  try {
    rpcResult = await client.rpc(RPC_NAME, {
      p_token_sha256: createHash("sha256")
        .update(capabilityToken, "utf8")
        .digest("hex"),
    });
  } catch {
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }

  if (rpcResult.error) {
    const errorCode = rpcErrorCode(rpcResult.error);
    if (errorCode === "capability_not_found") return null;
    if (errorCode === "capability_invalid") {
      throw new HermesCapabilityVerificationError("capability_invalid");
    }
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }

  if (!Array.isArray(rpcResult.data) || rpcResult.data.length !== 1) {
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }
  const row = rpcResult.data[0];
  if (!isExactRpcRow(row)) {
    throw new HermesCapabilityVerificationError("persistence_unavailable");
  }

  const expiresAt = row.expires_at;
  if (!isFutureTimestamp(expiresAt, now) || row.revoked_at !== null) {
    throw new HermesCapabilityVerificationError("capability_invalid");
  }
  return {
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    conversationId: row.conversation_id,
    invocationId: row.invocation_id,
    actorFingerprint: row.actor_fingerprint,
    expiresAt,
    revokedAt: null,
  };
}

function rpcErrorCode(error: unknown): string | null {
  if (!isRecord(error) || error.code !== "P0001") return null;
  return error.message === "capability_not_found" ||
    error.message === "capability_invalid"
    ? error.message
    : null;
}

function isExactRpcRow(value: unknown): value is {
  organization_id: string;
  owner_user_id: string;
  conversation_id: string;
  invocation_id: string;
  actor_fingerprint: string;
  expires_at: string;
  revoked_at: null;
} {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === RPC_RESULT_KEYS.length &&
    keys.every((key, index) => key === RPC_RESULT_KEYS[index]) &&
    isUuid(value.organization_id) &&
    isUuid(value.owner_user_id) &&
    isUuid(value.conversation_id) &&
    isUuid(value.invocation_id) &&
    isSha256(value.actor_fingerprint) &&
    typeof value.expires_at === "string" &&
    value.revoked_at === null
  );
}

function bearerCapability(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match && CAPABILITY_PATTERN.test(match[1]) ? match[1] : null;
}

function json(body: unknown, status: number): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isExactEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isFutureTimestamp(value: string, now: Date): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
