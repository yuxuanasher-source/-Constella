import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type AdmissionShareRateLimitClient = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export type AdmissionShareRateLimitPolicy = {
  scope: string;
  limit: number;
  windowSeconds: number;
};

export const ADMISSION_SHARE_RATE_LIMITS = {
  board: {
    scope: "admission-share-board",
    limit: 60,
    windowSeconds: 60,
  },
  recording: {
    scope: "admission-share-recording",
    limit: 30,
    windowSeconds: 60,
  },
  review: {
    scope: "admission-share-review",
    limit: 10,
    windowSeconds: 600,
  },
} as const satisfies Record<string, AdmissionShareRateLimitPolicy>;

export class RateLimitDeniedError extends Error {
  readonly name = "RateLimitDeniedError";

  constructor(
    public readonly retryAfterSeconds: number,
    public readonly dimension: "token" | "ip",
  ) {
    super("Too many requests");
  }
}

export class RateLimitUnavailableError extends Error {
  readonly name = "RateLimitUnavailableError";

  constructor() {
    super("Request protection is temporarily unavailable");
  }
}

export async function enforceAdmissionShareRateLimit({
  client,
  request,
  token,
  policy,
}: {
  client: AdmissionShareRateLimitClient;
  request: Request;
  token: string;
  policy: AdmissionShareRateLimitPolicy;
}): Promise<void> {
  const dimensions = [
    { name: "ip" as const, value: clientIpFromRequest(request) },
    { name: "token" as const, value: token.trim() },
  ];

  for (const dimension of dimensions) {
    const result = await consumeBucket({
      client,
      scope: `${policy.scope}:${dimension.name}`,
      dimensionHash: hashDimensionKey(
        policy.scope,
        dimension.name,
        dimension.value,
      ),
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    });
    if (!result.allowed) {
      throw new RateLimitDeniedError(
        Math.max(1, result.retryAfterSeconds),
        dimension.name,
      );
    }
  }
}

export function clientIpFromRequest(request: Request): string {
  for (const header of [
    "x-vercel-forwarded-for",
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
  ]) {
    const forwarded = request.headers.get(header);
    if (!forwarded) {
      continue;
    }
    const firstAddress = forwarded.split(",", 1)[0]?.trim();
    if (firstAddress) {
      return canonicalizeIp(firstAddress);
    }
  }
  return "unavailable";
}

function canonicalizeIp(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const closingBracket = normalized.indexOf("]");
    if (closingBracket > 1) {
      const bracketedAddress = normalized.slice(1, closingBracket);
      if (isIP(bracketedAddress)) {
        return bracketedAddress;
      }
    }
  }

  const lastColon = normalized.lastIndexOf(":");
  if (lastColon > 0 && normalized.indexOf(":") === lastColon) {
    const possibleIpv4 = normalized.slice(0, lastColon);
    if (isIP(possibleIpv4) === 4) {
      return possibleIpv4;
    }
  }
  return normalized;
}

function hashDimensionKey(
  scope: string,
  dimension: "token" | "ip",
  value: string,
) {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(dimension)
    .update("\0")
    .update(value)
    .digest("hex");
}

async function consumeBucket({
  client,
  scope,
  dimensionHash,
  limit,
  windowSeconds,
}: {
  client: AdmissionShareRateLimitClient;
  scope: string;
  dimensionHash: string;
  limit: number;
  windowSeconds: number;
}) {
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc("consume_admission_share_rate_limit", {
      p_scope: scope,
      p_dimension_hash: dimensionHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
  } catch {
    throw new RateLimitUnavailableError();
  }

  if (response.error) {
    throw new RateLimitUnavailableError();
  }
  const row = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!isRateLimitRow(row)) {
    throw new RateLimitUnavailableError();
  }
  return {
    allowed: row.allowed,
    retryAfterSeconds: finiteNonNegativeInteger(row.retry_after_seconds),
  };
}

function isRateLimitRow(
  value: unknown,
): value is { allowed: boolean; retry_after_seconds: number } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { allowed?: unknown }).allowed === "boolean" &&
    typeof (value as { retry_after_seconds?: unknown }).retry_after_seconds ===
      "number"
  );
}

function finiteNonNegativeInteger(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : 0;
}
