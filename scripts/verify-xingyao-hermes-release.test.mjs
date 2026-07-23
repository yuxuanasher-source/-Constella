import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  buildReleaseEvidence,
  writeReleaseEvidence,
} from "./verify-xingyao-hermes-release.mjs";

const sha256Pattern = /^[a-f0-9]{64}$/;
const verifierScript = "scripts/verify-xingyao-hermes-release.mjs";

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

  it("reads model identifiers from a file instead of process arguments", () => {
    const workspace = mkdtempSync(join(tmpdir(), "hermes-release-cli-"));
    const outputPath = join(workspace, "evidence.json");
    const modelIdentifierPath = join(workspace, "model-id.txt");
    const migrationPath = join(workspace, "migration.sql");
    const health8642Path = join(workspace, "health-8642.log");
    const health8643Path = join(workspace, "health-8643.log");

    try {
      writeFileSync(modelIdentifierPath, "xingyao/hermes-secret-model-2026\n");
      writeFileSync(migrationPath, "create table hermes_gateway(id uuid);\n");
      writeFileSync(health8642Path, "ok 8642 with token-like text\n");
      writeFileSync(health8643Path, "ok 8643 with token-like text\n");

      const result = spawnSync(
        process.execPath,
        [
          verifierScript,
          "--output",
          outputPath,
          "--product-commit",
          "1234567890abcdef1234567890abcdef12345678",
          "--fork-commit",
          "abcdef1234567890abcdef1234567890abcdef12",
          "--upstream-tag",
          "xingyao-hermes-v1.8.0",
          "--upstream-commit",
          "fedcba9876543210fedcba9876543210fedcba98",
          "--protocol",
          "hermes-native-gateway",
          "--profile",
          "production-canary",
          "--model-identifier-file",
          modelIdentifierPath,
          "--schema-migration-file",
          migrationPath,
          "--test-result",
          "curl 8642 healthz=passed:" + health8642Path,
          "--test-result",
          "curl 8643 healthz=passed:" + health8643Path,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);

      const evidenceText = readFileSync(outputPath, "utf8");
      const evidence = JSON.parse(evidenceText);
      expect(evidence.modelIdentifierHash).toMatch(sha256Pattern);
      expect(evidence.testResults.map((testResult) => testResult.name)).toEqual(
        ["curl 8642 healthz", "curl 8643 healthz"],
      );
      expect(evidenceText).not.toContain("hermes-secret-model-2026");
      expect(evidenceText).not.toContain("token-like text");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("documents file/stdin model identifier inputs without raw argv model identifiers", () => {
    const result = spawnSync(process.execPath, [verifierScript, "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--model-identifier-file <path>");
    expect(result.stdout).toContain("--model-identifier-stdin");
    expect(result.stdout).not.toContain("--model-identifier <identifier>");
  });
});

describe("Xingyao Hermes runbook release controls", () => {
  const runbook = readFileSync(
    "docs/runbooks/xingyao-hermes-gateway.md",
    "utf8",
  );

  it("uses a single gateway allowlist entry instead of split canary env vars", () => {
    expect(runbook).toContain("XINGYAO_HERMES_GATEWAY_ALLOWLIST=");
    expect(runbook).toContain("<organization-uuid>/<user-uuid>");
    expect(runbook).not.toContain("XINGYAO_HERMES_CANARY_ORGANIZATION_UUID");
    expect(runbook).not.toContain("XINGYAO_HERMES_CANARY_USER_UUID");
  });

  it("requires both Hermes service health checks before canary evidence", () => {
    expect(runbook).toContain("curl -fsS http://127.0.0.1:8642/healthz");
    expect(runbook).toContain("curl -fsS http://127.0.0.1:8643/healthz");
    expect(runbook).toContain("artifacts/hermes-8642-healthz.log");
    expect(runbook).toContain("artifacts/hermes-8643-healthz.log");
  });
});
