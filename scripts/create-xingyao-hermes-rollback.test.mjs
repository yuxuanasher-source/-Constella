import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const rollbackScript = join(
  repoRoot,
  "scripts/create-xingyao-hermes-rollback.sh",
);
const shellPath = (path) => path.replace(/\\/g, "/");
const bashBin = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "bash",
].find((candidate) => candidate === "bash" || existsSync(candidate));

describe("Xingyao Hermes rollback package", () => {
  it("creates a rollback package with hashes and without env files or secret values", () => {
    const workspace = mkdtempSync(join(tmpdir(), "hermes-rollback-"));
    const appDir = join(workspace, "app");
    const outputDir = join(workspace, "rollback");

    try {
      mkdirSync(join(appDir, "scripts"), { recursive: true });
      mkdirSync(join(appDir, "docs/runbooks"), { recursive: true });
      mkdirSync(join(appDir, "supabase/migrations"), { recursive: true });
      writeFileSync(
        join(appDir, "scripts/deploy.sh"),
        "#!/usr/bin/env bash\necho deploy\n",
      );
      writeFileSync(
        join(appDir, "docs/runbooks/xingyao-hermes-gateway.md"),
        "rollback instructions without sensitive values\n",
      );
      writeFileSync(
        join(appDir, "supabase/migrations/20260722000000_hermes_gateway.sql"),
        "create table hermes_gateway_release(id uuid primary key);\n",
      );
      writeFileSync(
        join(appDir, ".env.production"),
        "XINGYAO_HERMES_API_KEY=sk-live-secret\n",
      );

      const result = spawnSync(
        bashBin,
        [
          shellPath(rollbackScript),
          "--app-dir",
          shellPath(appDir),
          "--output-dir",
          shellPath(outputDir),
          "--product-commit",
          "1234567890abcdef1234567890abcdef12345678",
          "--previous-commit",
          "2222222222222222222222222222222222222222",
          "--reason",
          "canary failed",
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);

      const manifest = readFileSync(join(outputDir, "manifest.txt"), "utf8");
      expect(manifest).toContain(
        "product_commit=1234567890abcdef1234567890abcdef12345678",
      );
      expect(manifest).toContain(
        "previous_commit=2222222222222222222222222222222222222222",
      );
      expect(manifest).toMatch(/sha256\([^)]+\)=\b[a-f0-9]{64}\b/);

      const rollbackCommand = readFileSync(
        join(outputDir, "rollback-command.sh"),
        "utf8",
      );
      expect(rollbackCommand).toContain("git reset --hard");
      expect(rollbackCommand).toContain("pm2 restart");

      const packageText = [
        manifest,
        rollbackCommand,
        readFileSync(join(outputDir, "files/scripts/deploy.sh"), "utf8"),
        readFileSync(
          join(outputDir, "files/docs/runbooks/xingyao-hermes-gateway.md"),
          "utf8",
        ),
      ].join("\n");

      expect(packageText).not.toContain("sk-live-secret");
      expect(packageText).not.toMatch(/api[_-]?key|token|secret/i);
      expect(() =>
        readFileSync(join(outputDir, "files/.env.production"), "utf8"),
      ).toThrow();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
