#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createReadStream,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(message) {
  process.stderr.write(`[verify-rollback-package] ${message}\n`);
  process.exit(1);
}

const [mode, packageInput, expectedManifestSha256] = process.argv.slice(2);
if (!["verify", "execute"].includes(mode))
  fail("mode must be verify or execute");
if (!packageInput || !isAbsolute(packageInput)) {
  fail("rollback package path must be absolute");
}
if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? "")) {
  fail("reviewed manifest SHA-256 is required");
}

let packageDir;
try {
  packageDir = realpathSync(resolve(packageInput));
} catch {
  fail("rollback package directory does not exist");
}
const manifestPath = join(packageDir, "manifest.txt");
const requiredFiles = new Set([
  "files/deploy.sh",
  "files/release-integrity.mjs",
  "files/verify-release.sh",
  "rollback-command.sh",
]);

async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectStream);
    stream.on("end", resolveStream);
  });
  return hash.digest("hex");
}

function safeFile(relativePath) {
  if (
    relativePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`unsafe package path: ${relativePath}`);
  }
  const path = join(packageDir, ...relativePath.split("/"));
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail(`package entry is missing: ${relativePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`package entry must be a regular non-symlink file: ${relativePath}`);
  }
  let physical;
  try {
    physical = realpathSync(path);
  } catch {
    fail(`package entry cannot be resolved: ${relativePath}`);
  }
  const relativePhysical = relative(packageDir, physical).split(sep).join("/");
  if (relativePhysical === ".." || relativePhysical.startsWith("../")) {
    fail(`package entry escaped package directory: ${relativePath}`);
  }
  return path;
}

if ((await hashFile(safeFile("manifest.txt"))) !== expectedManifestSha256) {
  fail("rollback package manifest hash mismatch");
}
const manifest = readFileSync(manifestPath, "utf8");
const hashes = new Map();
for (const line of manifest.split(/\r?\n/)) {
  const match = line.match(/^sha256\(([^)]+)\)=([0-9a-f]{64})$/);
  if (!match) continue;
  if (hashes.has(match[1])) fail(`duplicate package hash: ${match[1]}`);
  hashes.set(match[1], match[2]);
}
if (
  hashes.size !== requiredFiles.size ||
  [...requiredFiles].some((entry) => !hashes.has(entry))
) {
  fail("rollback package manifest does not contain the exact required files");
}
for (const [relativePath, expected] of hashes) {
  if ((await hashFile(safeFile(relativePath))) !== expected) {
    fail(`rollback package file hash mismatch: ${relativePath}`);
  }
}

if (mode === "verify") {
  process.stdout.write("[verify-rollback-package] package verified\n");
  process.exit(0);
}
const bash = process.platform === "win32" ? "bash" : "/usr/bin/bash";
const result = spawnSync(bash, [safeFile("rollback-command.sh")], {
  cwd: packageDir,
  env: process.env,
  stdio: "inherit",
});
if (result.error)
  fail(`cannot start rollback command: ${result.error.message}`);
process.exit(result.status ?? 1);
