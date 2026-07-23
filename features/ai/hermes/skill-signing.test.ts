import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalHermesSkillManifest,
  loadHermesSkillSigningKeyFromEnv,
  signHermesSkillApproval,
  verifyHermesSkillApproval,
} from "./skill-signing";

const MANIFEST = {
  version: "1.0.0",
  skillId: "risk-review",
  requiredReadScopes: ["projects.summary", "knowledge.search"],
  allowedRoles: ["owner", "ops_manager"],
};
const BUNDLE_SHA256 = "a".repeat(64);

describe("Hermes Skill signing", () => {
  it("canonicalizes manifests deterministically before signing", () => {
    const left = canonicalHermesSkillManifest({
      skillId: "risk-review",
      version: "1.0.0",
      allowedRoles: ["owner", "ops_manager"],
      requiredReadScopes: ["projects.summary", "knowledge.search"],
    });
    const right = canonicalHermesSkillManifest({
      requiredReadScopes: ["projects.summary", "knowledge.search"],
      allowedRoles: ["owner", "ops_manager"],
      version: "1.0.0",
      skillId: "risk-review",
    });

    expect(left).toBe(right);
    expect(left).toBe(
      '{"allowedRoles":["owner","ops_manager"],"requiredReadScopes":["projects.summary","knowledge.search"],"skillId":"risk-review","version":"1.0.0"}',
    );
  });

  it("signs and verifies canonical manifest plus bundle hash with Ed25519", () => {
    const key = testSigningKey("skill-key-2026-07");

    const first = signHermesSkillApproval({
      manifest: MANIFEST,
      bundleSha256: BUNDLE_SHA256,
      signingKey: key.private,
    });
    const second = signHermesSkillApproval({
      manifest: { ...MANIFEST },
      bundleSha256: BUNDLE_SHA256,
      signingKey: key.private,
    });

    expect(first.signature).toBe(second.signature);
    expect(first.signingKeyId).toBe("skill-key-2026-07");
    expect(
      verifyHermesSkillApproval({
        manifest: { ...MANIFEST },
        bundleSha256: BUNDLE_SHA256,
        signature: first.signature,
        signingKeyId: first.signingKeyId,
        publicKeys: { "skill-key-2026-07": key.publicKeyPem },
      }),
    ).toBe(true);
  });

  it.each([
    ["manifest", { manifest: { ...MANIFEST, skillId: "other-skill" } }],
    ["bundle", { bundleSha256: "b".repeat(64) }],
    ["key id", { signingKeyId: "other-key" }],
    ["signature", { signature: "00" }],
  ])("fails verification after tampering with %s", (_name, override) => {
    const key = testSigningKey("skill-key-2026-07");
    const approval = signHermesSkillApproval({
      manifest: MANIFEST,
      bundleSha256: BUNDLE_SHA256,
      signingKey: key.private,
    });

    expect(
      verifyHermesSkillApproval({
        manifest: MANIFEST,
        bundleSha256: BUNDLE_SHA256,
        signature: approval.signature,
        signingKeyId: approval.signingKeyId,
        publicKeys: { "skill-key-2026-07": key.publicKeyPem },
        ...override,
      }),
    ).toBe(false);
  });

  it("loads a server-only private key without serializing or exposing it", () => {
    const key = testSigningKey("skill-key-2026-07");
    const loaded = loadHermesSkillSigningKeyFromEnv({
      XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY: key.privateKeyPem,
      XINGYAO_HERMES_SKILL_SIGNING_KEY_ID: "skill-key-2026-07",
    });

    expect(loaded.keyId).toBe("skill-key-2026-07");
    expect(loaded.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(JSON.stringify(loaded)).not.toContain(key.privateKeyPem);
    expect(JSON.stringify(loaded)).not.toContain("PRIVATE KEY");
    expect(Object.keys(loaded)).not.toContain("privateKey");
  });

  it("fails closed when the signing private key is not Ed25519", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;

    expect(() =>
      loadHermesSkillSigningKeyFromEnv({
        XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY: privateKeyPem,
        XINGYAO_HERMES_SKILL_SIGNING_KEY_ID: "rsa-key",
      }),
    ).toThrow(/Ed25519/);
  });

  it("rejects non-Ed25519 public keys during verification", () => {
    const key = testSigningKey("skill-key-2026-07");
    const { publicKey: rsaPublicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const approval = signHermesSkillApproval({
      manifest: MANIFEST,
      bundleSha256: BUNDLE_SHA256,
      signingKey: key.private,
    });

    expect(
      verifyHermesSkillApproval({
        manifest: MANIFEST,
        bundleSha256: BUNDLE_SHA256,
        signature: approval.signature,
        signingKeyId: approval.signingKeyId,
        publicKeys: {
          "skill-key-2026-07": rsaPublicKey.export({
            type: "spki",
            format: "pem",
          }) as string,
        },
      }),
    ).toBe(false);
  });
});

function testSigningKey(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const loaded = loadHermesSkillSigningKeyFromEnv({
    XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY: privateKeyPem,
    XINGYAO_HERMES_SKILL_SIGNING_KEY_ID: keyId,
  });
  return { private: loaded, privateKeyPem, publicKeyPem };
}
