import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
  verifierDigest: string;
  expiresAt: number;
};

export function signAdmissionShareCapability({
  boardExpiresAt,
  now,
  ...binding
}: CapabilityBinding & {
  boardExpiresAt: string;
  now: string;
}) {
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
      verifierDigest: verifierDigest(binding.accessCodeHash),
      expiresAt,
    } satisfies CapabilityPayload),
  ).toString("base64url");
  const signature = sign(encodedPayload, binding.accessCodeHash);
  return {
    value: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyAdmissionShareCapability({
  capability,
  now,
  ...binding
}: CapabilityBinding & {
  capability: string | undefined;
  now: string;
}) {
  if (!capability) {
    return false;
  }
  const [encodedPayload, suppliedSignature, extra] = capability.split(".");
  if (!encodedPayload || !suppliedSignature || extra) {
    return false;
  }
  const expectedSignature = sign(encodedPayload, binding.accessCodeHash);
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
      payload.verifierDigest === verifierDigest(binding.accessCodeHash) &&
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

function verifierDigest(accessCodeHash: string) {
  return createHash("sha256").update(accessCodeHash).digest("hex");
}

function sign(encodedPayload: string, accessCodeHash: string) {
  return createHmac("sha256", accessCodeHash)
    .update(encodedPayload)
    .digest("base64url");
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
