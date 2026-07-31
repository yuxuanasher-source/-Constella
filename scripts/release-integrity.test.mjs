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

describe("release integrity manifest", () => {
  it("binds a clean Git SHA to server and static build output", () => {
    const root = mkdtempSync(join(tmpdir(), "release-integrity-"));
    try {
      mkdirSync(join(root, ".next/server"), { recursive: true });
      mkdirSync(join(root, ".next/static"), { recursive: true });
      writeFileSync(join(root, "tracked.txt"), "reviewed source\n");
      for (const relativePath of [
        ".next/BUILD_ID",
        ".next/build-manifest.json",
        ".next/prerender-manifest.json",
        ".next/required-server-files.json",
        ".next/routes-manifest.json",
        ".next/server/app.js",
        ".next/static/chunk.js",
      ]) {
        writeFileSync(join(root, relativePath), `${relativePath}\n`);
      }

      expect(run("git", ["init", "--quiet"], root).status).toBe(0);
      expect(
        run("git", ["config", "user.email", "test@example.invalid"], root)
          .status,
      ).toBe(0);
      expect(
        run("git", ["config", "user.name", "Release Test"], root).status,
      ).toBe(0);
      expect(run("git", ["add", "tracked.txt"], root).status).toBe(0);
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
      expect(
        JSON.parse(readFileSync(join(root, ".release-integrity.json"), "utf8"))
          .sha,
      ).toBe(sha);
      expect(
        run(process.execPath, [verifier, "verify", root, sha], root).status,
      ).toBe(0);

      writeFileSync(join(root, ".next/server/app.js"), "tampered build\n");
      const tamperedBuild = run(
        process.execPath,
        [verifier, "verify", root, sha],
        root,
      );
      expect(tamperedBuild.status).not.toBe(0);
      expect(tamperedBuild.stderr).toMatch(/build output differs/i);

      writeFileSync(join(root, ".next/server/app.js"), ".next/server/app.js\n");
      writeFileSync(join(root, "tracked.txt"), "tampered source\n");
      const tamperedSource = run(
        process.execPath,
        [verifier, "verify", root, sha],
        root,
      );
      expect(tamperedSource.status).not.toBe(0);
      expect(tamperedSource.stderr).toMatch(/Git state/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
