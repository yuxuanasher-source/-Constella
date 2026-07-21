import {
  CompactSign,
  compactVerify,
  decodeProtectedHeader,
  importPKCS8,
  importSPKI,
} from "jose";

import {
  HERMES_AUDIENCE,
  LEGACY_HERMES_PROFILE_VERSION,
  XINGYAO_PRODUCT_ISSUER,
  isKnownHermesActorProfile,
  type HermesActorProfile,
} from "./contracts";
import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "./actor-fingerprint";

type SignOptions = {
  privateKeyPem: string;
  kid: string;
  now?: Date;
  ttlSeconds?: number;
};

type VerifyOptions = {
  publicKeyPem: string;
  now?: Date;
  audience?: string;
};

export async function signHermesActorAssertion(
  actor: HermesActorProfile,
  options: SignOptions,
): Promise<string> {
  if (
    !isKnownHermesActorProfile(actor) ||
    actor.skillGrantsHash !== computeHermesSkillGrantsHash(actor.enabledSkillVersions)
  ) {
    throw new Error("invalid Hermes actor profile");
  }
  if (!options.privateKeyPem?.trim()) {
    throw new Error("Hermes actor assertion private key is required");
  }
  if (!options.kid?.trim()) {
    throw new Error("Hermes actor assertion kid is required");
  }

  const ttlSeconds = options.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) {
    throw new Error(
      "Hermes actor assertion ttl must be between 1 and 300 seconds",
    );
  }

  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const privateKey = await importPKCS8(options.privateKeyPem, "RS256");
  const payload = {
    iss: XINGYAO_PRODUCT_ISSUER,
    aud: HERMES_AUDIENCE,
    sub: actor.userId,
    organizationId: actor.organizationId,
    role: actor.role,
    conversationId: actor.conversationId,
    invocationId: actor.invocationId,
    allowedReadScopes: actor.allowedReadScopes,
    enabledSkillVersions: actor.enabledSkillVersions,
    skillGrantsHash: actor.skillGrantsHash,
    profileVersion: actor.profileVersion,
    pageContext: actor.pageContext,
    jti: actor.invocationId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };

  return new CompactSign(toRuntimeUint8Array(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "RS256", kid: options.kid, typ: "JWT" })
    .sign(privateKey);
}

export async function verifyHermesActorAssertion(
  token: string,
  options: VerifyOptions,
): Promise<{
  actor: HermesActorProfile;
  actorFingerprint: string;
  header: { alg: "RS256"; kid?: string };
}> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256") {
    throw new Error("Hermes actor assertion must use RS256");
  }
  if (!options.publicKeyPem?.trim()) {
    throw new Error("Hermes actor assertion public key is required");
  }

  const publicKey = await importSPKI(options.publicKeyPem, "RS256");
  let payload: Record<string, unknown>;
  try {
    const verified = await compactVerify(token, publicKey, {
      algorithms: ["RS256"],
    });
    payload = JSON.parse(
      Buffer.from(verified.payload).toString("utf8"),
    ) as Record<string, unknown>;
  } catch (error) {
    throw error;
  }

  if (payload.iss !== XINGYAO_PRODUCT_ISSUER) {
    throw new Error("Hermes actor assertion issuer mismatch");
  }
  if (payload.aud !== (options.audience ?? HERMES_AUDIENCE)) {
    throw new Error("Hermes actor assertion audience mismatch");
  }
  if (!isNumber(payload.exp)) {
    throw new Error("Hermes actor assertion expiration is required");
  }
  if (!isNumber(payload.iat)) {
    throw new Error("Hermes actor assertion issued-at is required");
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (payload.exp <= nowSeconds) {
    throw new Error("Hermes actor assertion expired");
  }
  if (payload.exp <= payload.iat || payload.exp - payload.iat > 300) {
    throw new Error("Hermes actor assertion lifetime is invalid");
  }

  const actor = actorProfileFromClaims(payload);
  if (!hasOnlyAssertionClaims(payload) || !actor) {
    throw new Error("invalid Hermes actor assertion actor profile");
  }

  return {
    actor,
    actorFingerprint: createHermesActorFingerprint(actor),
    header: { alg: "RS256", kid: header.kid },
  };
}

function hasOnlyAssertionClaims(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload).sort();
  return (
    keys.length === ASSERTION_CLAIM_KEYS.length &&
    keys.every((key, index) => key === ASSERTION_CLAIM_KEYS[index])
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toRuntimeUint8Array(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value));
}

export const HERMES_ASSERTION_PROFILE_VERSION =
  LEGACY_HERMES_PROFILE_VERSION;

const ASSERTION_CLAIM_KEYS = [
  "allowedReadScopes",
  "aud",
  "conversationId",
  "enabledSkillVersions",
  "exp",
  "iat",
  "iss",
  "jti",
  "organizationId",
  "pageContext",
  "profileVersion",
  "role",
  "skillGrantsHash",
  "sub",
  "invocationId",
].sort();

function actorProfileFromClaims(
  payload: Record<string, unknown>,
): HermesActorProfile | null {
  const actor = {
    userId: payload.sub,
    organizationId: payload.organizationId,
    role: payload.role,
    conversationId: payload.conversationId,
    invocationId: payload.jti,
    allowedReadScopes: payload.allowedReadScopes,
    enabledSkillVersions: payload.enabledSkillVersions,
    skillGrantsHash: payload.skillGrantsHash,
    profileVersion: payload.profileVersion,
    pageContext: payload.pageContext,
  };

  return isKnownHermesActorProfile(actor) &&
    payload.invocationId === actor.invocationId &&
    actor.skillGrantsHash === computeHermesSkillGrantsHash(actor.enabledSkillVersions)
    ? actor
    : null;
}
