import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const extractor = join(process.cwd(), "scripts/extract-release-artifact.mjs");

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tar(entries) {
  const parts = [];
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, "utf8");
    header.write(octal(entry.mode ?? 0o640, 8), 100, 8, "ascii");
    header.write(octal(0, 8), 108, 8, "ascii");
    header.write(octal(0, 8), 116, 8, "ascii");
    header.write(octal(contents.length, 12), 124, 12, "ascii");
    header.write(octal(0, 12), 136, 12, "ascii");
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(
      `${checksum.toString(8).padStart(6, "0")}\0 `,
      148,
      8,
      "ascii",
    );
    parts.push(header, contents);
    const padding = (512 - (contents.length % 512)) % 512;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function run(archive, destination, artifactHash, releaseSha) {
  return spawnSync(
    process.execPath,
    [extractor, archive, destination, artifactHash, releaseSha],
    { encoding: "utf8" },
  );
}

describe("trusted release artifact extraction", () => {
  it("extracts only regular ustar runtime entries after exact hash validation", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "release-artifact-"));
    const releaseSha = "a".repeat(40);
    const destination = join(sandbox, releaseSha);
    const archivePath = join(sandbox, "release-runtime.tar");
    try {
      mkdirSync(destination);
      const archive = tar([
        {
          path: ".release-integrity.json",
          contents: `{"version":2,"sha":"${releaseSha}","files":[]}\n`,
          mode: 0o600,
        },
        {
          path: ".next/standalone",
          contents: "",
          type: "5",
          mode: 0o750,
        },
        {
          path: ".next/standalone/server.js",
          contents: "server\n",
          mode: 0o640,
        },
        {
          path: ".next/standalone/.release-sha",
          contents: `${releaseSha}\n`,
          mode: 0o600,
        },
        {
          path: ".next/standalone/large.bin",
          contents: Buffer.alloc(2 * 1024 * 1024 + 17, 7),
          mode: 0o640,
        },
      ]);
      writeFileSync(archivePath, archive);

      const extracted = run(
        archivePath,
        destination,
        sha256(archive),
        releaseSha,
      );
      expect(extracted.status, extracted.stderr).toBe(0);
      expect(
        readFileSync(join(destination, ".next/standalone/server.js"), "utf8"),
      ).toBe("server\n");
      expect(
        statSync(join(destination, ".next/standalone/large.bin")).size,
      ).toBe(2 * 1024 * 1024 + 17);
      if (process.platform !== "win32") {
        expect(
          statSync(join(destination, ".next/standalone/.release-sha")).mode &
            0o777,
        ).toBe(0o600);
      }

      const wrongHashDestination = join(sandbox, "b".repeat(40));
      mkdirSync(wrongHashDestination);
      const wrongHash = run(
        archivePath,
        wrongHashDestination,
        "f".repeat(64),
        "b".repeat(40),
      );
      expect(wrongHash.status).not.toBe(0);
      expect(wrongHash.stderr).toMatch(/trusted SHA-256/i);
      expect(existsSync(join(wrongHashDestination, ".next"))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it.each([
    ["path traversal", "../escape", "0"],
    ["symlink", ".next/standalone/link", "2"],
    ["unexpected root", "secrets.env", "0"],
  ])("rejects %s entries before extraction", (_, unsafePath, type) => {
    const sandbox = mkdtempSync(join(tmpdir(), "unsafe-release-artifact-"));
    const releaseSha = "c".repeat(40);
    const destination = join(sandbox, releaseSha);
    const archivePath = join(sandbox, "unsafe.tar");
    try {
      mkdirSync(destination);
      const archive = tar([
        {
          path: ".release-integrity.json",
          contents: `{"version":2,"sha":"${releaseSha}","files":[]}\n`,
        },
        { path: ".next/standalone", contents: "", type: "5" },
        {
          path: ".next/standalone/server.js",
          contents: "server\n",
        },
        {
          path: ".next/standalone/.release-sha",
          contents: `${releaseSha}\n`,
        },
        { path: unsafePath, contents: "unsafe", type },
      ]);
      writeFileSync(archivePath, archive);
      const rejected = run(
        archivePath,
        destination,
        sha256(archive),
        releaseSha,
      );
      expect(rejected.status).not.toBe(0);
      expect(existsSync(join(destination, ".next"))).toBe(false);
      expect(existsSync(join(sandbox, "escape"))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "wrong embedded release SHA",
      (releaseSha) => [
        {
          path: ".release-integrity.json",
          contents: `{"version":2,"sha":"${releaseSha}","files":[]}\n`,
        },
        { path: ".next/standalone", contents: "", type: "5" },
        { path: ".next/standalone/server.js", contents: "server\n" },
        {
          path: ".next/standalone/.release-sha",
          contents: `${"d".repeat(40)}\n`,
        },
      ],
    ],
    [
      "wrong manifest release SHA",
      (releaseSha) => [
        {
          path: ".release-integrity.json",
          contents: `{"version":2,"sha":"${"d".repeat(40)}","files":[]}\n`,
        },
        { path: ".next/standalone", contents: "", type: "5" },
        { path: ".next/standalone/server.js", contents: "server\n" },
        {
          path: ".next/standalone/.release-sha",
          contents: `${releaseSha}\n`,
        },
      ],
    ],
    [
      "file used as an ancestor",
      (releaseSha) => [
        {
          path: ".release-integrity.json",
          contents: `{"version":2,"sha":"${releaseSha}","files":[]}\n`,
        },
        { path: ".next/standalone", contents: "not a directory" },
        { path: ".next/standalone/server.js", contents: "server\n" },
        {
          path: ".next/standalone/.release-sha",
          contents: `${releaseSha}\n`,
        },
      ],
    ],
  ])("rejects %s before writing runtime files", (_, entries) => {
    const sandbox = mkdtempSync(join(tmpdir(), "invalid-release-artifact-"));
    const releaseSha = "c".repeat(40);
    const destination = join(sandbox, releaseSha);
    const archivePath = join(sandbox, "invalid.tar");
    try {
      mkdirSync(destination);
      const archive = tar(entries(releaseSha));
      writeFileSync(archivePath, archive);
      const rejected = run(
        archivePath,
        destination,
        sha256(archive),
        releaseSha,
      );
      expect(rejected.status).not.toBe(0);
      expect(existsSync(join(destination, ".next"))).toBe(false);
      expect(existsSync(join(destination, ".release-integrity.json"))).toBe(
        false,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
