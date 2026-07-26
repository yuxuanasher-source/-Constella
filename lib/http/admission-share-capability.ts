import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMISSION_SHARE_CAPABILITY_COOKIE = "admission_share_capability";

type CapabilityBinding = {
  boardId: string;
  tokenHash: string;
  accessCodeHash: string;
};

type CapabilityPayload = {
  version: 1;
  boardId: string;
  tokenHash: string;
  expiresAt: number;
};

export class AdmissionShareCapabilityUnavailableError extends Error {
  readonly name = "AdmissionShareCapabilityUnavailableError";

  constructor() {
    super("Admission share capability secret is not configured");
  }
}

export function requireAdmissionShareCapabilitySecret(
  env: Record<string, string | undefined> = process.env,
) {
  return validateSecret(env.ADMISSION_SHARE_CAPABILITY_SECRET);
}

export function signAdmissionShareCapability({
  boardExpiresAt,
  now,
  secret,
  ...binding
}: CapabilityBinding & {
  boardExpiresAt: string;
  now: string;
  secret?: string;
}) {
  const signingSecret =
    secret === undefined
      ? requireAdmissionShareCapabilitySecret()
      : validateSecret(secret);
  const expiresAt = Math.min(
    Date.parse(boardExpiresAt),
    Date.parse(now) + 60 * 60 * 1000,
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(now)) {
    throw new Error("Share link is expired or revoked");
  }
  const encodedPayload = Buffer.from(
    JSON.stringify({
      version: 1,
      boardId: binding.boardId,
      tokenHash: binding.tokenHash,
      expiresAt,
    } satisfies CapabilityPayload),
  ).toString("base64url");
  const signature = sign(encodedPayload, binding, signingSecret);
  return {
    value: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyAdmissionShareCapability({
  capability,
  now,
  secret,
  ...binding
}: CapabilityBinding & {
  capability: string | undefined;
  now: string;
  secret?: string;
}) {
  if (!capability) {
    return false;
  }
  let signingSecret: string;
  try {
    signingSecret =
      secret === undefined
        ? requireAdmissionShareCapabilitySecret()
        : validateSecret(secret);
  } catch {
    return false;
  }
  const [encodedPayload, suppliedSignature, extra] = capability.split(".");
  if (!encodedPayload || !suppliedSignature || extra) {
    return false;
  }
  const expectedSignature = sign(encodedPayload, binding, signingSecret);
  if (!safeEqual(suppliedSignature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<CapabilityPayload>;
    return (
      payload.version === 1 &&
      payload.boardId === binding.boardId &&
      payload.tokenHash === binding.tokenHash &&
      typeof payload.expiresAt === "number" &&
      Number.isFinite(payload.expiresAt) &&
      payload.expiresAt >= Date.parse(now)
    );
  } catch {
    return false;
  }
}

export function admissionShareCapabilityFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === ADMISSION_SHARE_CAPABILITY_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function validateSecret(secret: string | undefined) {
  const normalized = secret?.trim();
  if (!normalized || normalized.length < 32) {
    throw new AdmissionShareCapabilityUnavailableError();
  }
  return normalized;
}

function sign(
  encodedPayload: string,
  binding: CapabilityBinding,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update("admission-share-capability-v1")
    .update("\0")
    .update(encodedPayload)
    .update("\0")
    .update(binding.boardId)
    .update("\0")
    .update(binding.tokenHash)
    .update("\0")
    .update(binding.accessCodeHash)
    .digest("base64url");
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
