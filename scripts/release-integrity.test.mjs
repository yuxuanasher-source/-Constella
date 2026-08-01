import { createHash } from "node:crypto";
import {
  chmodSync,
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
      mkdirSync(join(root, ".next/standalone/node_modules/next/source-map"));
      mkdirSync(join(root, ".next/standalone/node_modules/next/source-map08"));
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "supabase/migrations"), { recursive: true });
      const fixtureFiles = {
        ".next/standalone/server.js": "server\n",
        ".next/standalone/node_modules/next/runtime.js": "next runtime\n",
        ".next/standalone/node_modules/next/source-map/runtime.js":
          "source map\n",
        ".next/standalone/node_modules/next/source-map08/runtime.js":
          "source map 08\n",
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
        run("git", ["update-index", "--chmod=+x", "scripts/deploy.sh"], root)
          .status,
      ).toBe(0);
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
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.sha).toBe(sha);
      expect(
        manifest.files.find(({ path }) => path === "scripts/deploy.sh")?.mode,
      ).toBe(0o750);
      expect(
        manifest.files.find(({ path }) => path === "ecosystem.config.cjs")
          ?.mode,
      ).toBe(0o640);
      expect(
        manifest.files.find(({ path }) => path === ".next/standalone/server.js")
          ?.mode,
      ).toBe(0o640);
      expect(
        manifest.files.findIndex(
          ({ path }) =>
            path === ".next/standalone/node_modules/next/source-map/runtime.js",
        ),
      ).toBeLessThan(
        manifest.files.findIndex(
          ({ path }) =>
            path ===
            ".next/standalone/node_modules/next/source-map08/runtime.js",
        ),
      );
      chmodSync(join(root, "scripts/deploy.sh"), 0o700);
      chmodSync(join(root, "ecosystem.config.cjs"), 0o600);
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
