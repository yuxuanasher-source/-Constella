import { createHash } from "node:crypto";
import {
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

const verifier = join(process.cwd(), "scripts/release-integrity.mjs");

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("release integrity manifest", () => {
  it("binds a standalone runtime to an external digest without Git at rollback time", () => {
    const root = mkdtempSync(join(tmpdir(), "release-integrity-"));
    try {
      mkdirSync(join(root, ".next/standalone/node_modules/next"), {
        recursive: true,
      });
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "supabase/migrations"), { recursive: true });
      const fixtureFiles = {
        ".next/standalone/server.js": "server\n",
        ".next/standalone/node_modules/next/runtime.js": "next runtime\n",
        "ecosystem.config.cjs": "module.exports = {};\n",
        "scripts/create-xingyao-hermes-rollback.sh": "#!/usr/bin/env bash\n",
        "scripts/deploy.sh": "#!/usr/bin/env bash\n",
        "scripts/extract-release-artifact.mjs": "process.exit(0);\n",
        "scripts/prepare-standalone-release.mjs": "process.exit(0);\n",
        "scripts/release-integrity.mjs": "process.exit(0);\n",
        "scripts/validate-expand-migration.mjs": "process.exit(0);\n",
        "scripts/verify-release.sh": "#!/usr/bin/env bash\n",
        "scripts/verify-xingyao-hermes-rollback-package.mjs":
          "process.exit(0);\n",
        "supabase/migrations/20260731000000_fixture.sql":
          "-- deploy: expand\nselect 1;\n",
      };
      for (const [relativePath, content] of Object.entries(fixtureFiles)) {
        writeFileSync(join(root, relativePath), content);
      }

      expect(run("git", ["init", "--quiet"], root).status).toBe(0);
      expect(
        run("git", ["config", "user.email", "test@example.invalid"], root)
          .status,
      ).toBe(0);
      expect(
        run("git", ["config", "user.name", "Release Test"], root).status,
      ).toBe(0);
      expect(run("git", ["add", "."], root).status).toBe(0);
      expect(
        run("git", ["commit", "--quiet", "-m", "fixture"], root).status,
      ).toBe(0);
      const sha = run("git", ["rev-parse", "HEAD"], root).stdout.trim();

      const written = run(
        process.execPath,
        [verifier, "write", root, sha],
        root,
      );
      expect(written.status, written.stderr).toBe(0);
      const manifestPath = join(root, ".release-integrity.json");
      const manifestSha256 = sha256(manifestPath);
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).sha).toBe(sha);
      expect(
        run(
          process.execPath,
          [verifier, "verify", root, sha, manifestSha256],
          root,
        ).status,
      ).toBe(0);

      writeFileSync(
        join(root, ".next/standalone/node_modules/next/runtime.js"),
        "tampered runtime\n",
      );
      const tamperedRuntime = run(
        process.execPath,
        [verifier, "verify", root, sha, manifestSha256],
        root,
      );
      expect(tamperedRuntime.status).not.toBe(0);
      expect(tamperedRuntime.stderr).toMatch(/runtime artifact differs/i);

      writeFileSync(
        join(root, ".next/standalone/node_modules/next/runtime.js"),
        "next runtime\n",
      );
      writeFileSync(join(root, "ecosystem.config.cjs"), "tampered source\n");
      expect(
        run(
          process.execPath,
          [verifier, "verify", root, sha, manifestSha256],
          root,
        ).status,
      ).not.toBe(0);
      writeFileSync(
        join(root, "ecosystem.config.cjs"),
        "module.exports = {};\n",
      );

      rmSync(join(root, ".git"), { recursive: true, force: true });
      const sourceIndependent = run(
        process.execPath,
        [verifier, "verify", root, sha, manifestSha256],
        root,
      );
      expect(sourceIndependent.status, sourceIndependent.stderr).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
