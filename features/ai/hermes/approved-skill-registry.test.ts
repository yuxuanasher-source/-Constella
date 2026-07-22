import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  HERMES_BUILTIN_APPROVED_SKILLS,
  computeHermesSkillBundleSha256,
  getHermesBuiltinSkillArtifacts,
  resolveApprovedHermesSkillGrantsForActor,
  validateHermesSkillBundle,
} from "./approved-skill-registry";
import { loadHermesSkillSigningKeyFromEnv, signHermesSkillApproval } from "./skill-signing";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("Hermes approved Skill registry", () => {
  it("pins code-owned builtin Skill hashes to the migrated SKILL.md content", () => {
    const artifacts = getHermesBuiltinSkillArtifacts();

    expect(artifacts.map((artifact) => artifact.skillId)).toEqual([
      "business-context",
      "project-review",
      "report-precheck",
      "settlement-analysis",
    ]);
    for (const artifact of artifacts) {
      const pinned = HERMES_BUILTIN_APPROVED_SKILLS.find(
        (skill) => skill.skillId === artifact.skillId,
      );
      expect(pinned?.bundleSha256).toBe(
        computeHermesSkillBundleSha256(artifact.bundle),
      );
      expect(validateHermesSkillBundle(artifact.bundle, pinned?.bundleSha256)).toMatchObject({
        ok: true,
        files: [{ path: "SKILL.md" }],
      });
    }
  });

  it.each([
    ["traversal", bundle([{ path: "../SKILL.md", content: "x" }])],
    ["absolute", bundle([{ path: "/tmp/SKILL.md", content: "x" }])],
    ["symlink", bundle([{ path: "SKILL.md", content: "x", type: "symlink" }])],
    ["hardlink", bundle([{ path: "SKILL.md", content: "x", type: "hardlink" }])],
    ["executable", bundle([{ path: "SKILL.md", content: "x", mode: "100755" }])],
    ["numeric executable", bundle([{ path: "SKILL.md", content: "x", mode: 493 }])],
    ["invalid mode format", bundle([{ path: "SKILL.md", content: "x", mode: "493" }])],
    ["script", bundle([{ path: "scripts/run.sh", content: "echo hi" }])],
    ["native", bundle([{ path: "addon.node", content: "x" }])],
    ["wasm", bundle([{ path: "tool.wasm", content: "x" }])],
    ["dynamic mcp", bundle([{ path: "MCP.json", content: "{}" }])],
    ["env refs", bundle([{ path: "SKILL.md", content: "Use ${SECRET_KEY}" }])],
    [
      "duplicate",
      bundle([
        { path: "SKILL.md", content: "one" },
        { path: "SKILL.md", content: "two" },
      ]),
    ],
    [
      "dot segment duplicate",
      bundle([
        { path: "dir/file.md", content: "one" },
        { path: "dir/./file.md", content: "two" },
      ]),
    ],
    [
      "oversize",
      bundle([{ path: "SKILL.md", content: "x".repeat(128 * 1024 + 1) }]),
    ],
  ])("rejects dangerous bundle content: %s", (_name, candidate) => {
    expect(validateHermesSkillBundle(candidate).ok).toBe(false);
  });

  it("rejects hash mismatches", () => {
    expect(validateHermesSkillBundle("# Safe", "b".repeat(64))).toMatchObject({
      ok: false,
      reason: "hash_mismatch",
    });
  });

  it("resolves only approved signed rows matching actor org, user, role, scopes, hash, key id, and signature", () => {
    const key = testSigningKey("skill-key-2026-07");
    const row = approvedRow({
      signingKeyId: key.keyId,
      signature: signHermesSkillApproval({
        manifest: approvedManifest(),
        bundleSha256: computeHermesSkillBundleSha256("# Skill"),
        signingKey: key,
      }).signature,
    });

    const grants = resolveApprovedHermesSkillGrantsForActor({
      actor: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "owner",
        allowedReadScopes: ["projects.summary", "knowledge.search"],
      },
      rows: [
        row,
        { ...row, id: "33333333-3333-4333-8333-333333333333", status: "rejected" },
        { ...row, id: "33333333-3333-4333-8333-333333333334", status: "superseded" },
        { ...row, id: "33333333-3333-4333-8333-333333333335", status: "revoked" },
        { ...row, id: "33333333-3333-4333-8333-333333333336", signature: null },
        { ...row, id: "33333333-3333-4333-8333-333333333337", bundle_sha256: "b".repeat(64) },
        { ...row, id: "33333333-3333-4333-8333-333333333338", organization_id: "44444444-4444-4444-8444-444444444444" },
        { ...row, id: "33333333-3333-4333-8333-333333333339", owner_user_id: "55555555-5555-4555-8555-555555555555" },
      ],
      publicKeys: { [key.keyId]: key.publicKeyPem },
    });

    expect(grants).toEqual([
      {
        draftId: row.id,
        skillId: "risk-review",
        version: "1.0.0",
        bundleSha256: computeHermesSkillBundleSha256("# Skill"),
      },
    ]);
  });

  it("does not grant approved rows whose manifest version is not a complete semver", () => {
    const key = testSigningKey("skill-key-2026-07");
    const manifest = approvedManifest({ version: "1.0.0-not-semver?" });
    const bundleSha256 = computeHermesSkillBundleSha256("# Skill");
    const row = approvedRow({
      manifest,
      signingKeyId: key.keyId,
      signature: signHermesSkillApproval({
        manifest,
        bundleSha256,
        signingKey: key,
      }).signature,
    });

    expect(
      resolveApprovedHermesSkillGrantsForActor({
        actor: {
          organizationId: ORG_ID,
          userId: USER_ID,
          role: "owner",
          allowedReadScopes: ["projects.summary", "knowledge.search"],
        },
        rows: [row],
        publicKeys: { [key.keyId]: key.publicKeyPem },
      }),
    ).toEqual([]);
  });
});

function bundle(files: Array<Record<string, unknown>>) {
  return JSON.stringify({ files });
}

function approvedManifest(overrides: Record<string, unknown> = {}) {
  return {
    skillId: "risk-review",
    version: "1.0.0",
    allowedRoles: ["owner"],
    requiredReadScopes: ["projects.summary", "knowledge.search"],
    ...overrides,
  };
}

function approvedRow(overrides: Record<string, unknown> = {}) {
  const manifest = approvedManifest();
  const bundleText = "# Skill";
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: ORG_ID,
    owner_user_id: USER_ID,
    skill_id: "risk-review",
    version: 1,
    manifest,
    bundle: bundleText,
    bundle_sha256: computeHermesSkillBundleSha256(bundleText),
    status: "approved",
    signing_key_id: "skill-key-2026-07",
    signature: "missing",
    ...overrides,
  };
}

function testSigningKey(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const signingKey = loadHermesSkillSigningKeyFromEnv({
    XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY: privateKeyPem,
    XINGYAO_HERMES_SKILL_SIGNING_KEY_ID: keyId,
  });
  return signingKey;
}
