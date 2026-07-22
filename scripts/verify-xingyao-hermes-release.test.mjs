import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReleaseEvidence,
  writeReleaseEvidence,
} from "./verify-xingyao-hermes-release.mjs";

const sha256Pattern = /^[a-f0-9]{64}$/;

describe("Xingyao Hermes release evidence", () => {
  it("records commit, upstream, protocol, hashed model/schema, test results, and sha256 values without secrets", () => {
    const evidence = buildReleaseEvidence({
      productCommit: "1234567890abcdef1234567890abcdef12345678",
      forkCommit: "abcdef1234567890abcdef1234567890abcdef12",
      upstreamTag: "xingyao-hermes-v1.8.0",
      upstreamCommit: "fedcba9876543210fedcba9876543210fedcba98",
      protocol: "hermes-native-gateway",
      profile: "production-canary",
      modelIdentifier: "xingyao/hermes-secret-model-2026",
      schemaMigrationSql:
        "create table xingyao_native_gateway(secret_token text);",
      testResults: [
        {
          name: "pnpm test:ai-system",
          status: "passed",
          output: "ok with HERMES_API_KEY=sk-live-secret",
        },
      ],
      artifacts: [
        {
          name: "release-notes",
          content: "deployed with TOKEN=super-secret-value",
        },
      ],
      generatedAt: "2026-07-22T08:00:00.000Z",
    });

    expect(evidence.productCommit).toBe(
      "1234567890abcdef1234567890abcdef12345678",
    );
    expect(evidence.forkCommit).toBe(
      "abcdef1234567890abcdef1234567890abcdef12",
    );
    expect(evidence.upstream).toEqual({
      tag: "xingyao-hermes-v1.8.0",
      commit: "fedcba9876543210fedcba9876543210fedcba98",
    });
    expect(evidence.protocolProfile).toEqual({
      protocol: "hermes-native-gateway",
      profile: "production-canary",
    });
    expect(evidence.modelIdentifierHash).toMatch(sha256Pattern);
    expect(evidence.schemaMigrationHash).toMatch(sha256Pattern);
    expect(evidence.testResults).toEqual([
      {
        name: "pnpm test:ai-system",
        status: "passed",
        outputSha256: expect.stringMatching(sha256Pattern),
      },
    ]);
    expect(evidence.artifacts).toEqual([
      {
        name: "release-notes",
        sha256: expect.stringMatching(sha256Pattern),
      },
    ]);

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("hermes-secret-model-2026");
    expect(serialized).not.toContain("secret_token");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it("writes a JSON evidence file for Product release handoff", () => {
    const workspace = mkdtempSync(join(tmpdir(), "hermes-release-"));
    const outputPath = join(workspace, "evidence.json");

    try {
      const evidence = buildReleaseEvidence({
        productCommit: "1234567890abcdef1234567890abcdef12345678",
        forkCommit: "abcdef1234567890abcdef1234567890abcdef12",
        upstreamTag: "xingyao-hermes-v1.8.0",
        upstreamCommit: "fedcba9876543210fedcba9876543210fedcba98",
        protocol: "hermes-native-gateway",
        profile: "production-canary",
        modelIdentifier: "xingyao/hermes-native",
        schemaMigrationSql: "alter table ai_drafts add column gateway text;",
        testResults: [{ name: "bash -n rollback", status: "passed" }],
        artifacts: [{ name: "rollback-script", content: "no secrets here" }],
        generatedAt: "2026-07-22T08:00:00.000Z",
      });

      writeReleaseEvidence(evidence, outputPath);

      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(evidence);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
