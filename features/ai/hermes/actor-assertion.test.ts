import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  HERMES_ASSERTION_PROFILE_VERSION,
  signHermesActorAssertion,
  verifyHermesActorAssertion,
} from "./actor-assertion";
import type { HermesActorProfile } from "./contracts";

describe("Hermes actor assertion", () => {
  it("signs and verifies an RS256 actor assertion with a configured key and kid", async () => {
    expect(HERMES_ASSERTION_PROFILE_VERSION).toBe(
      "hermes-xingyao-v1+skills.c1755ec71e802748",
    );
    const keys = rsaKeyPair();
    const token = await signHermesActorAssertion(PROFILE, {
      privateKeyPem: keys.privateKeyPem,
      kid: "test-key-1",
      now: new Date("2026-07-20T00:00:00.000Z"),
      ttlSeconds: 300,
    });

    await expect(
      verifyHermesActorAssertion(token, {
        publicKeyPem: keys.publicKeyPem,
        now: new Date("2026-07-20T00:04:59.000Z"),
      }),
    ).resolves.toMatchObject({
      actor: PROFILE,
      actorFingerprint:
        "e81c5a662616209a2e5e22da39bfc791bf822dd51314fab8918615e895bc41a4",
      header: { alg: "RS256", kid: "test-key-1" },
    });
  });

  it("rejects expired, wrong-audience, HS256, missing key config, and unknown actor fields", async () => {
    const keys = rsaKeyPair();
    const token = await signHermesActorAssertion(PROFILE, {
      privateKeyPem: keys.privateKeyPem,
      kid: "test-key-1",
      now: new Date("2026-07-20T00:00:00.000Z"),
      ttlSeconds: 1,
    });

    await expect(
      verifyHermesActorAssertion(token, {
        publicKeyPem: keys.publicKeyPem,
        now: new Date("2026-07-20T00:00:02.000Z"),
      }),
    ).rejects.toThrow("expired");
    await expect(
      verifyHermesActorAssertion(token, {
        publicKeyPem: keys.publicKeyPem,
        audience: "other-audience",
        now: new Date("2026-07-20T00:00:00.000Z"),
      }),
    ).rejects.toThrow("audience");
    await expect(
      verifyHermesActorAssertion(HS256_TOKEN, {
        publicKeyPem: keys.publicKeyPem,
        now: new Date("2026-07-20T00:00:00.000Z"),
      }),
    ).rejects.toThrow("RS256");
    await expect(
      signHermesActorAssertion(PROFILE, {
        privateKeyPem: "",
        kid: "test-key-1",
      }),
    ).rejects.toThrow("private key");
    await expect(
      signHermesActorAssertion(
        {
          ...PROFILE,
          userName: "client injected",
        } as unknown as HermesActorProfile,
        {
          privateKeyPem: keys.privateKeyPem,
          kid: "test-key-1",
        },
      ),
    ).rejects.toThrow("actor profile");
    await expect(
      signHermesActorAssertion(
        { ...PROFILE, profileVersion: "custom" },
        {
          privateKeyPem: keys.privateKeyPem,
          kid: "test-key-1",
        },
      ),
    ).rejects.toThrow("actor profile");
  });
});

const PROFILE: HermesActorProfile = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "owner",
  conversationId: "33333333-3333-4333-8333-333333333333",
  invocationId: "44444444-4444-4444-8444-444444444444",
  allowedReadScopes: ["context.read", "projects.summary"],
  enabledSkillVersions: [
    {
      skillId: "project-review",
      version: "1.0.0",
      bundleSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      skillId: "report-precheck",
      version: "2.0.0",
      bundleSha256:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ],
  skillGrantsHash:
    "458147f2ca44ee9d33b9c01dfdf8b678ff903b27b7c0a6aa8b92ced3c644c310",
  profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
  pageContext: {
    pageType: "project",
    objectIds: ["66666666-6666-4666-8666-666666666666"],
  },
};

const HS256_TOKEN = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJpc3MiOiJ4aW5neWFvLXByb2R1Y3QiLCJhdWQiOiJ4aW5neWFvLWhlcm1lcy1hZ2VudCJ9",
  "signature",
].join(".");

function rsaKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
