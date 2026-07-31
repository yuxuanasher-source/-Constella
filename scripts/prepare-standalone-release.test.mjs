import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/prepare-standalone-release.mjs");

function run(root, sha) {
  return spawnSync(process.execPath, [script, root, sha], {
    encoding: "utf8",
  });
}

describe("standalone release preparation", () => {
  it("copies the runtime assets and binds the full release SHA", () => {
    const root = mkdtempSync(join(tmpdir(), "standalone-release-"));
    const sha = "a".repeat(40);
    try {
      mkdirSync(join(root, ".next/standalone"), { recursive: true });
      mkdirSync(join(root, ".next/standalone/.next"), { recursive: true });
      mkdirSync(join(root, ".next/static/chunks"), { recursive: true });
      mkdirSync(join(root, "public/assets"), { recursive: true });
      writeFileSync(
        join(root, ".next/standalone/server.js"),
        `const buildRoot = ${JSON.stringify(root)};\n`,
      );
      writeFileSync(
        join(root, ".next/standalone/.next/required-server-files.json"),
        `${JSON.stringify({ appDir: root })}\n`,
      );
      writeFileSync(join(root, ".next/static/chunks/app.js"), "chunk\n");
      writeFileSync(join(root, "public/assets/logo.txt"), "logo\n");

      const prepared = run(root, sha);
      expect(prepared.status, prepared.stderr).toBe(0);
      expect(
        readFileSync(
          join(root, ".next/standalone/.next/static/chunks/app.js"),
          "utf8",
        ),
      ).toBe("chunk\n");
      expect(
        readFileSync(
          join(root, ".next/standalone/public/assets/logo.txt"),
          "utf8",
        ),
      ).toBe("logo\n");
      expect(
        readFileSync(join(root, ".next/standalone/.release-sha"), "utf8"),
      ).toBe(`${sha}\n`);
      expect(
        readFileSync(join(root, ".next/standalone/server.js"), "utf8"),
      ).not.toContain(root);
      expect(
        readFileSync(
          join(root, ".next/standalone/.next/required-server-files.json"),
          "utf8",
        ),
      ).not.toContain(root);
      if (process.platform !== "win32") {
        expect(
          statSync(join(root, ".next/standalone/server.js")).mode & 0o777,
        ).toBe(0o640);
      }

      expect(run(root, "short").status).not.toBe(0);
      rmSync(join(root, ".next/standalone/server.js"));
      expect(run(root, sha).status).not.toBe(0);

      rmSync(join(root, ".next/standalone"), {
        recursive: true,
        force: true,
      });
      mkdirSync(join(root, "outside"), { recursive: true });
      writeFileSync(join(root, "outside/server.js"), "server\n");
      symlinkSync(
        join(root, "outside"),
        join(root, ".next/standalone"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(run(root, sha).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
