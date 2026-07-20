import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signHermesActorAssertion,
  verifyHermesActorAssertion,
} from "./actor-assertion";
import type { HermesActorProfile } from "./contracts";

describe("Hermes actor assertion", () => {
  it("signs and verifies an RS256 actor assertion with a configured key and kid", async () => {
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
  });
});

const PROFILE: HermesActorProfile = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "owner",
  conversationId: "33333333-3333-4333-8333-333333333333",
  allowedReadScopes: ["context.read", "projects.search"],
  skillGrantsHash: "grants-v1",
  profileVersion: "hermes-xingyao-v1",
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
