import { randomUUID } from "node:crypto";

import { SignJWT, importPKCS8, importSPKI, jwtVerify } from "jose";
import { z } from "zod";

import type { AuthContext } from "@/lib/auth/context";

import {
  ACTOR_ASSERTION_AUDIENCE,
  ACTOR_ASSERTION_ISSUER,
  HERMES_PROFILE_VERSION,
  actorAssertionClaimsSchema,
  canonicalUuidSchema,
  skillGrantSchema,
  type ActorAssertionClaims,
  type SkillGrant,
} from "./contracts";
import {
  buildActorFingerprint,
  buildSkillGrantsHash,
  normalizeSkillGrants,
} from "./actor-fingerprint";
import { sanitizeHermesPageContext } from "./page-context";
import {
  isCompleteHermesAuthContext,
  resolveHermesReadScopes,
} from "./read-scopes";

const ASSERTION_TTL_SECONDS = 300;
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const signingInputSchema = z.strictObject({
  auth: z.custom<AuthContext>(isCompleteHermesAuthContext),
  conversationId: canonicalUuidSchema,
  invocationId: canonicalUuidSchema,
  skillGrants: z.array(skillGrantSchema).max(50),
  pageContext: z.custom<unknown>((value) => value !== undefined),
});

type ActorAssertionEnvironment = Partial<
  Record<
    | "XINGYAO_ACTOR_JWS_PRIVATE_KEY"
    | "XINGYAO_ACTOR_JWS_PUBLIC_KEY"
    | "XINGYAO_ACTOR_JWS_KEY_ID",
    string
  >
>;

export type SignHermesActorAssertionInput = {
  auth: AuthContext;
  conversationId: string;
  invocationId: string;
  skillGrants: readonly SkillGrant[];
  pageContext: unknown;
};

export type SignedHermesActorAssertion = Readonly<{
  token: string;
  claims: ActorAssertionClaims;
  actorFingerprint: string;
}>;

export class HermesActorAssertionInputError extends TypeError {
  readonly code = "actor_assertion_signing_input_invalid";

  constructor() {
    super("Hermes actor assertion signing input is invalid");
    this.name = "HermesActorAssertionInputError";
  }
}

export class HermesActorAssertionConfigurationError extends Error {
  readonly code:
    | "actor_jws_not_configured"
    | "actor_jws_invalid_key_configuration";

  constructor(
    code: "actor_jws_not_configured" | "actor_jws_invalid_key_configuration",
  ) {
    super(
      code === "actor_jws_not_configured"
        ? "Hermes actor JWS is not configured"
        : "Hermes actor JWS key configuration is invalid",
    );
    this.name = "HermesActorAssertionConfigurationError";
    this.code = code;
  }
}

function normalizePem(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes("\\n") && !trimmed.includes("\n")
    ? `${trimmed.replace(/\\n/g, "\n")}\n`
    : `${trimmed}\n`;
}

function loadKeyConfiguration(env: ActorAssertionEnvironment): {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId: string;
} {
  const privateKey = env.XINGYAO_ACTOR_JWS_PRIVATE_KEY;
  const publicKey = env.XINGYAO_ACTOR_JWS_PUBLIC_KEY;
  const keyId = env.XINGYAO_ACTOR_JWS_KEY_ID?.trim();
  if (!privateKey?.trim() || !publicKey?.trim() || !keyId) {
    throw new HermesActorAssertionConfigurationError(
      "actor_jws_not_configured",
    );
  }
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new HermesActorAssertionConfigurationError(
      "actor_jws_invalid_key_configuration",
    );
  }
  return {
    privateKeyPem: normalizePem(privateKey),
    publicKeyPem: normalizePem(publicKey),
    keyId,
  };
}

function assertStrongRsaKey(key: CryptoKey): void {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (
    algorithm.name !== "RSASSA-PKCS1-v1_5" ||
    typeof algorithm.modulusLength !== "number" ||
    algorithm.modulusLength < 2_048
  ) {
    throw new HermesActorAssertionConfigurationError(
      "actor_jws_invalid_key_configuration",
    );
  }
}

function freezeClaims(claims: ActorAssertionClaims): ActorAssertionClaims {
  const enabledSkillVersions = Object.freeze(
    claims.enabledSkillVersions.map((grant) => Object.freeze({ ...grant })),
  );
  const pageContext = Object.freeze({
    ...claims.pageContext,
    objectIds: Object.freeze([...claims.pageContext.objectIds]),
  });
  return Object.freeze({
    ...claims,
    allowedReadScopes: Object.freeze([...claims.allowedReadScopes]),
    enabledSkillVersions,
    pageContext,
  }) as ActorAssertionClaims;
}

export async function signHermesActorAssertion(
  input: SignHermesActorAssertionInput,
): Promise<SignedHermesActorAssertion> {
  const parsedInput = signingInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new HermesActorAssertionInputError();
  }

  let claims: ActorAssertionClaims;
  let actorFingerprint: string;
  let now: Date;
  try {
    now = new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new HermesActorAssertionInputError();
    }
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const allowedReadScopes = resolveHermesReadScopes(parsedInput.data.auth);
    const enabledSkillVersions = normalizeSkillGrants(
      parsedInput.data.skillGrants,
    );
    const skillGrantsHash = buildSkillGrantsHash(enabledSkillVersions);
    const pageContext = sanitizeHermesPageContext(parsedInput.data.pageContext);
    const jti = randomUUID();

    claims = actorAssertionClaimsSchema.parse({
      iss: ACTOR_ASSERTION_ISSUER,
      aud: ACTOR_ASSERTION_AUDIENCE,
      sub: parsedInput.data.auth.userId,
      organizationId: parsedInput.data.auth.organizationId,
      role: parsedInput.data.auth.role,
      conversationId: parsedInput.data.conversationId,
      invocationId: parsedInput.data.invocationId,
      allowedReadScopes,
      enabledSkillVersions,
      skillGrantsHash,
      profileVersion: HERMES_PROFILE_VERSION,
      pageContext: {
        pageType: pageContext.pageType,
        objectIds: [...pageContext.objectIds],
      },
      jti,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_TTL_SECONDS,
    });
    actorFingerprint = buildActorFingerprint({
      userId: claims.sub,
      organizationId: claims.organizationId,
      role: claims.role,
      conversationId: claims.conversationId,
      allowedReadScopes: claims.allowedReadScopes,
      skillGrantsHash: claims.skillGrantsHash,
      profileVersion: claims.profileVersion,
    });
  } catch (error) {
    if (error instanceof HermesActorAssertionInputError) {
      throw error;
    }
    throw new HermesActorAssertionInputError();
  }

  const configuration = loadKeyConfiguration({
    XINGYAO_ACTOR_JWS_PRIVATE_KEY: process.env.XINGYAO_ACTOR_JWS_PRIVATE_KEY,
    XINGYAO_ACTOR_JWS_PUBLIC_KEY: process.env.XINGYAO_ACTOR_JWS_PUBLIC_KEY,
    XINGYAO_ACTOR_JWS_KEY_ID: process.env.XINGYAO_ACTOR_JWS_KEY_ID,
  });
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  try {
    [privateKey, publicKey] = await Promise.all([
      importPKCS8(configuration.privateKeyPem, "RS256"),
      importSPKI(configuration.publicKeyPem, "RS256"),
    ]);
    assertStrongRsaKey(privateKey);
    assertStrongRsaKey(publicKey);
  } catch (error) {
    if (error instanceof HermesActorAssertionConfigurationError) {
      throw error;
    }
    throw new HermesActorAssertionConfigurationError(
      "actor_jws_invalid_key_configuration",
    );
  }

  let token: string;
  try {
    token = await new SignJWT({ ...claims })
      .setProtectedHeader({
        alg: "RS256",
        typ: "JWT",
        kid: configuration.keyId,
      })
      .sign(privateKey);
    await jwtVerify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: ACTOR_ASSERTION_ISSUER,
      audience: ACTOR_ASSERTION_AUDIENCE,
      currentDate: now,
    });
  } catch {
    throw new HermesActorAssertionConfigurationError(
      "actor_jws_invalid_key_configuration",
    );
  }

  return Object.freeze({
    token,
    claims: freezeClaims(claims),
    actorFingerprint,
  });
}
