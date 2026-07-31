#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(message) {
  process.stderr.write(`[release-integrity] ${message}\n`);
  process.exit(1);
}

const [mode, rootInput, expectedSha, expectedManifestSha256] =
  process.argv.slice(2);
if (!["write", "verify"].includes(mode)) fail("mode must be write or verify");
if (!rootInput || !isAbsolute(rootInput)) fail("release root must be absolute");
if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  fail("expected SHA must be a full lowercase Git SHA");
}
if (mode === "verify" && !/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? "")) {
  fail("trusted manifest SHA-256 is required for verification");
}

const root = realpathSync(resolve(rootInput));
const manifestPath = join(root, ".release-integrity.json");
const requiredEntries = [
  ".next/standalone",
  "ecosystem.config.cjs",
  "scripts/create-xingyao-hermes-rollback.sh",
  "scripts/deploy.sh",
  "scripts/prepare-standalone-release.mjs",
  "scripts/release-integrity.mjs",
  "scripts/validate-expand-migration.mjs",
  "scripts/verify-release.sh",
  "scripts/verify-xingyao-hermes-rollback-package.mjs",
  "supabase/migrations",
];

function git(args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: options.quiet ? "ignore" : ["ignore", "pipe", "pipe"],
  });
}

function assertGitState() {
  let actual;
  try {
    actual = git(["rev-parse", "HEAD"]).trim().toLowerCase();
    git(["diff", "--quiet", "--ignore-submodules", "--"], { quiet: true });
    git(["diff", "--cached", "--quiet", "--ignore-submodules", "--"], {
      quiet: true,
    });
  } catch {
    fail("release Git state cannot be verified or has tracked changes");
  }
  if (actual !== expectedSha) {
    fail(`release Git HEAD mismatch: expected ${expectedSha}, found ${actual}`);
  }
}

function relativeReleasePath(path) {
  const relativePath = relative(root, path).split(sep).join("/");
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    fail("runtime artifact escaped release root");
  }
  return relativePath;
}

function collectFiles(path, output, visitedDirectories) {
  if (!existsSync(path)) {
    fail(`required runtime artifact is missing: ${relative(root, path)}`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(path);
    relativeReleasePath(target);
    output.push({
      path,
      linkTarget: relative(root, target).split(sep).join("/"),
    });
    collectFiles(target, output, visitedDirectories);
    return;
  }
  if (stat.isFile()) {
    output.push({ path });
    return;
  }
  if (!stat.isDirectory()) {
    fail(`unsupported runtime artifact type: ${relative(root, path)}`);
  }
  const physical = realpathSync(path);
  relativeReleasePath(physical);
  if (visitedDirectories.has(physical)) {
    fail(
      `runtime artifact contains a directory cycle: ${relative(root, path)}`,
    );
  }
  visitedDirectories.add(physical);
  for (const entry of readdirSync(path).sort()) {
    collectFiles(join(path, entry), output, visitedDirectories);
  }
  visitedDirectories.delete(physical);
}

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

async function snapshot() {
  const absoluteFiles = [];
  const visitedDirectories = new Set();
  for (const entry of requiredEntries) {
    collectFiles(join(root, entry), absoluteFiles, visitedDirectories);
  }
  const uniqueFiles = [
    ...new Map(
      absoluteFiles.map((entry) => [
        `${entry.path}\0${entry.linkTarget ?? ""}`,
        entry,
      ]),
    ).values(),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const files = [];
  for (const entry of uniqueFiles) {
    const path = relativeReleasePath(entry.path);
    if (entry.linkTarget) {
      files.push({
        path,
        type: "symlink",
        target: entry.linkTarget,
      });
      continue;
    }
    files.push({
      path,
      type: "file",
      mode: lstatSync(entry.path).mode & 0o777,
      size: lstatSync(entry.path).size,
      sha256: await hashFile(entry.path),
    });
  }
  return { version: 2, sha: expectedSha, files };
}

if (mode === "write") assertGitState();
const current = await snapshot();

if (mode === "write") {
  writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`, {
    mode: 0o600,
  });
  const manifestSha256 = await hashFile(manifestPath);
  process.stdout.write(
    `[release-integrity] wrote ${current.files.length} hashes\n${manifestSha256}\n`,
  );
} else {
  const actualManifestSha256 = await hashFile(manifestPath).catch(() => "");
  if (actualManifestSha256 !== expectedManifestSha256) {
    fail("release integrity manifest does not match its trusted SHA-256");
  }
  let expected;
  try {
    expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("release integrity manifest is missing or invalid");
  }
  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    fail("release runtime artifact differs from its integrity manifest");
  }
  process.stdout.write(
    `[release-integrity] verified ${current.files.length} hashes\n`,
  );
}
