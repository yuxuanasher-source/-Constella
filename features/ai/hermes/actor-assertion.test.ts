// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";

import {
  SignJWT,
  decodeProtectedHeader,
  importPKCS8,
  importSPKI,
  jwtVerify,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "@/lib/auth/context";

import actorFixtureJson from "./fixtures/actor-assertion-v1.json";
import {
  ACTOR_ASSERTION_AUDIENCE,
  ACTOR_ASSERTION_ISSUER,
  XINGYAO_READ_SCOPES,
  actorAssertionClaimsSchema,
  actorAssertionFixtureSchema,
} from "./contracts";
import {
  HermesActorAssertionConfigurationError,
  signHermesActorAssertion,
} from "./actor-assertion";
import {
  buildActorFingerprint,
  buildReadScopesHash,
  buildSkillGrantsHash,
} from "./actor-fingerprint";

const FIXED_NON_PRODUCTION_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC/5tUl2NGLtRX5
tBEufdv0/4CxPxiPP43TbYaVWyMbfSWIdnd3heEzNiuw5CeTM8ILqKzhtoF7nBKS
aC3RZ4T2fU1fGh6vnZC/tsFPCLwSuRynomQy7CH7NgZoAqpg55M4PDBeGH0hWqFP
RsZpRwZwR3B3yMdxnAePg3Ug1oVxbT4EsFxltja81GgIwaoUxNgc4dVO6v4AH4Jn
F3SdbsihVpQtE7alSuk5dsgJP8EyDxz3y3ZU70kqMmEBQqgF19K/1B0AlllIWq/v
JE7KJJbCsGt5pMpKxviii2NLYLAXPtT4vZIl1G3GEl5e2n82c4mywIQzkGrTCR43
+TrVFOHrAgMBAAECggEAOXvcin9F2dsvT4LUiMAz1NJ6it2zLinkApry7yeDPzdA
OH4AMGH+wRfvg4f8oNgmvtZSnzRL2iq413l0jB890ZZcSGorGgERfJQymMmtiNBB
mKeI60YXscgPqDVwMyH7VCOXe4BLb2PWIUi6o4uejqCfvIn80HfkPeWrfuAzzfNd
bH4mSbE4jRPRyJ47fXWSywSR3rMRUoY8/UpQZvlVXAoDx8457Ciz12Yf/Wznsoub
f37Pdr/xY2K9Fcg45BIOGC+ETyWq87WVl5xFvEVMyvfdDfyYIKf8bEOGvB4FouS1
L2ji04gH3BdfE7G7qCPQ2+Gso2rz9+jlySMtwy/HXQKBgQD0egT+/n6VvpekDNik
yy73OSZ+qz+PCQdbKMXoxg8lkYLB0pJ+d5r5BUlfAIRfSa0PSkxwduL+emWbX9r4
/tn5DdvNPNpcE7fcXcnUtuPVZlvIz9nB3jiYZ0UbpahxZki7fhPwwvIRMR53iB9t
BEErLRWU0L5ttnjBUpMd1ZW6LQKBgQDI8mqzdulA8pnB7Kp8EZijxMam/xiFgrjj
L5eVQKuwocM/90FVC2pyW36FrtPEIlsnkV1DH4zs9/M1ZE6u6aN/rNL6NIvFeski
gtJiVbf+o9C4QogkMKXO6FUjp4Jno4gpm8IE53XALOAXYwiQlyymrYmzpA2SOOif
lWQKipITdwKBgAZCcYpN3dPbs2pB4fImOaee0PuBSvlQk92jp52UJKMjnKN1zsZq
LY+esQg7rSf7bPDtSBPBF4LIg3188NBbRh14W15f5n9hCd4ckKRfomm+Wy9DEyJB
nFVan4xbq3pr0gTq73vEogoKpesNkzBpYXnHh7vttFJ+z4yznoyvAUxpAoGADRPB
n+ZILcLcAMPPIH3gqh+/MdT+Goo0UAyj18G6qqcMVthXdxpkFgcgR8Dl5Si7N+r8
38Zo3G8Sc9IQUM/BpShxHnlW80YXWtiaqm2bqMWuap9hzsEfuURjbguTr/zzeom5
aapKfnQtLThzsT01Wa+He5pci7yKXwBQ32K/OOcCgYBwzW318GNDjhKVNw2VvrA2
HUUrbFSiLXMFN4DB64G9EF9n5eV36fimLPUgx4Q9UaPGc/dBFCvEksi7SKhVY5X/
3ZPZLjm5KaGICPvySGINqMiozg48DrSIpBQ2YUQVvLotkVXO7Obs7ZyFFovVEy9g
PzCSaEVPhKgJW1VJJ9lTgw==
-----END PRIVATE KEY-----
`;

const fixture = actorAssertionFixtureSchema.parse(actorFixtureJson);
const auth: AuthContext = {
  userId: fixture.claims.sub,
  email: "owner@example.test",
  name: "Test Owner",
  organizationId: fixture.claims.organizationId,
  organizationName: "Test Organization",
  role: "owner",
};

function signingEnvironment(publicKeyPem = fixture.publicKeyPem) {
  return {
    XINGYAO_ACTOR_JWS_PRIVATE_KEY: FIXED_NON_PRODUCTION_PRIVATE_KEY,
    XINGYAO_ACTOR_JWS_PUBLIC_KEY: publicKeyPem,
    XINGYAO_ACTOR_JWS_KEY_ID: fixture.protectedHeader.kid,
  };
}

function signingInput() {
  return {
    auth,
    conversationId: fixture.claims.conversationId,
    invocationId: fixture.claims.invocationId,
    skillGrants: fixture.claims.enabledSkillVersions,
    pageContext: fixture.claims.pageContext,
  };
}

describe("Hermes actor assertion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixture.claims.iat * 1_000));
    for (const [key, value] of Object.entries(signingEnvironment())) {
      vi.stubEnv(key, value);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("re-signs and verifies the frozen cross-repository fixture", async () => {
    const privateKey = await importPKCS8(
      FIXED_NON_PRODUCTION_PRIVATE_KEY,
      "RS256",
    );
    const resigned = await new SignJWT({ ...fixture.claims })
      .setProtectedHeader(fixture.protectedHeader)
      .sign(privateKey);

    expect(resigned).toBe(fixture.token);
    const publicKey = await importSPKI(fixture.publicKeyPem, "RS256");
    const verified = await jwtVerify(fixture.token, publicKey, {
      algorithms: ["RS256"],
      issuer: ACTOR_ASSERTION_ISSUER,
      audience: ACTOR_ASSERTION_AUDIENCE,
      currentDate: new Date((fixture.claims.iat + 1) * 1_000),
    });
    const claims = actorAssertionClaimsSchema.parse(verified.payload);

    expect(claims).toEqual(fixture.claims);
    expect(buildSkillGrantsHash(claims.enabledSkillVersions)).toBe(
      fixture.expected.skillGrantsHash,
    );
    expect(buildReadScopesHash(claims.allowedReadScopes)).toBe(
      fixture.expected.scopesHash,
    );
    expect(
      buildActorFingerprint({
        userId: claims.sub,
        organizationId: claims.organizationId,
        role: claims.role,
        conversationId: claims.conversationId,
        allowedReadScopes: claims.allowedReadScopes,
        skillGrantsHash: claims.skillGrantsHash,
        profileVersion: claims.profileVersion,
      }),
    ).toBe(fixture.expected.actorFingerprint);
  });

  it("signs only server-derived identity and role scopes with a 300 second TTL", async () => {
    const result = await signHermesActorAssertion(signingInput());
    const header = decodeProtectedHeader(result.token);
    const publicKey = await importSPKI(fixture.publicKeyPem, "RS256");
    const verified = await jwtVerify(result.token, publicKey, {
      algorithms: ["RS256"],
      issuer: ACTOR_ASSERTION_ISSUER,
      audience: ACTOR_ASSERTION_AUDIENCE,
      currentDate: new Date((fixture.claims.iat + 1) * 1_000),
    });
    const claims = actorAssertionClaimsSchema.parse(verified.payload);

    expect(header).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: fixture.protectedHeader.kid,
    });
    expect(claims.sub).toBe(auth.userId);
    expect(claims.organizationId).toBe(auth.organizationId);
    expect(claims.role).toBe(auth.role);
    expect(claims.allowedReadScopes).toEqual([...XINGYAO_READ_SCOPES].sort());
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims).not.toHaveProperty("email");
    expect(claims).not.toHaveProperty("organizationName");
    expect(result.actorFingerprint).toHaveLength(64);
  });

  it("accepts PEM values stored with escaped newlines", async () => {
    const env = signingEnvironment();
    vi.stubEnv(
      "XINGYAO_ACTOR_JWS_PRIVATE_KEY",
      env.XINGYAO_ACTOR_JWS_PRIVATE_KEY.replace(/\n/g, "\\n"),
    );
    vi.stubEnv(
      "XINGYAO_ACTOR_JWS_PUBLIC_KEY",
      env.XINGYAO_ACTOR_JWS_PUBLIC_KEY.replace(/\n/g, "\\n"),
    );

    await expect(
      signHermesActorAssertion(signingInput()),
    ).resolves.toMatchObject({ actorFingerprint: expect.any(String) });
  });

  it("rejects client-controlled identity fields at the signing boundary", async () => {
    await expect(
      signHermesActorAssertion({
        ...signingInput(),
        organizationId: "99999999-9999-4999-8999-999999999999",
        allowedReadScopes: ["settlements.summary"],
      } as never),
    ).rejects.toThrow("signing input is invalid");
  });

  it("fails closed when any required asymmetric key setting is missing", async () => {
    for (const key of [
      "XINGYAO_ACTOR_JWS_PRIVATE_KEY",
      "XINGYAO_ACTOR_JWS_PUBLIC_KEY",
      "XINGYAO_ACTOR_JWS_KEY_ID",
    ] as const) {
      const env = signingEnvironment();
      vi.stubEnv(key, "");

      await expect(
        signHermesActorAssertion(signingInput()),
      ).rejects.toBeInstanceOf(HermesActorAssertionConfigurationError);
      vi.stubEnv(key, env[key]);
    }
  });

  it("never reflects private keys, attacker values, or generated tokens in errors", async () => {
    const invalidPrivateKey = "sensitive-not-an-rsa-private-key";
    vi.stubEnv("XINGYAO_ACTOR_JWS_PRIVATE_KEY", invalidPrivateKey);
    try {
      await signHermesActorAssertion(signingInput());
      throw new Error("expected invalid private key to fail");
    } catch (error) {
      expect(String(error)).not.toContain(invalidPrivateKey);
      expect(String(error)).not.toContain("PRIVATE KEY");
    }

    const mismatchedPublicKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).publicKey;
    vi.stubEnv(
      "XINGYAO_ACTOR_JWS_PRIVATE_KEY",
      signingEnvironment().XINGYAO_ACTOR_JWS_PRIVATE_KEY,
    );
    vi.stubEnv("XINGYAO_ACTOR_JWS_PUBLIC_KEY", mismatchedPublicKey);
    try {
      await signHermesActorAssertion(signingInput());
      throw new Error("expected mismatched public key to fail");
    } catch (error) {
      expect(String(error)).not.toContain("eyJ");
      expect(String(error)).not.toContain(mismatchedPublicKey);
    }
  });
});
