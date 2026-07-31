import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
const shellPath = (path) => {
  const normalized = path.replace(/\\/g, "/");
  if (process.platform !== "win32") return normalized;
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
};
const bashBin = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "bash",
].find((candidate) => candidate === "bash" || existsSync(candidate));

describe("Xingyao Hermes atomic rollback package", () => {
  it("creates a symlink rollback package without source reset or secrets", () => {
    const workspace = mkdtempSync(join(tmpdir(), "hermes-rollback-"));
    const releaseRoot = join(workspace, "releases");
    const outputDir = join(workspace, "rollback");
    const currentLink = join(workspace, "current");
    const productCommit = "1234567890abcdef1234567890abcdef12345678";
    const previousCommit = "2222222222222222222222222222222222222222";

    try {
      for (const sha of [productCommit, previousCommit]) {
        const release = join(releaseRoot, sha);
        mkdirSync(join(release, "scripts"), { recursive: true });
        writeFileSync(
          join(release, "ecosystem.config.cjs"),
          "module.exports = {};\n",
        );
        writeFileSync(
          join(release, "scripts/deploy.sh"),
          "#!/usr/bin/env bash\nverify_release() { :; }\n",
        );
        writeFileSync(
          join(release, "scripts/verify-release.sh"),
          "#!/usr/bin/env bash\nexit 0\n",
          { mode: 0o755 },
        );
      }
      symlinkSync(
        join(releaseRoot, productCommit),
        currentLink,
        process.platform === "win32" ? "junction" : "dir",
      );

      const result = spawnSync(
        bashBin,
        [
          shellPath(rollbackScript),
          "--release-root",
          shellPath(releaseRoot),
          "--current-link",
          shellPath(currentLink),
          "--output-dir",
          shellPath(outputDir),
          "--product-commit",
          productCommit,
          "--previous-commit",
          previousCommit,
          "--reason",
          "canary failed",
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      const manifest = readFileSync(join(outputDir, "manifest.txt"), "utf8");
      expect(manifest).toContain(`product_commit=${productCommit}`);
      expect(manifest).toContain(`previous_commit=${previousCommit}`);
      expect(manifest).toContain(`release_root=${shellPath(releaseRoot)}`);
      expect(manifest).toMatch(/sha256\([^)]+\)=\b[a-f0-9]{64}\b/);

      const rollbackCommand = readFileSync(
        join(outputDir, "rollback-command.sh"),
        "utf8",
      );
      expect(rollbackCommand).toContain("CURRENT_LINK=");
      expect(rollbackCommand).toContain("acquire_deploy_lock");
      expect(rollbackCommand).toContain("verify_release");
      expect(rollbackCommand).toContain("save_pm2");
      expect(rollbackCommand).not.toContain("git reset --hard");
      expect(rollbackCommand).not.toContain("HERMES_ROLLBACK_OVERRIDE");

      const packageText = [
        manifest,
        rollbackCommand,
        readFileSync(join(outputDir, "files/deploy.sh"), "utf8"),
        readFileSync(join(outputDir, "files/verify-release.sh"), "utf8"),
      ].join("\n");
      expect(packageText).not.toMatch(/sk-live-secret|api[_-]?key/i);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
