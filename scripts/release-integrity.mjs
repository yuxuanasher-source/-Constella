#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(message) {
  process.stderr.write(`[release-integrity] ${message}\n`);
  process.exit(1);
}

const [mode, rootInput, expectedSha] = process.argv.slice(2);
if (!["write", "verify"].includes(mode)) fail("mode must be write or verify");
if (!rootInput || !isAbsolute(rootInput)) fail("release root must be absolute");
if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  fail("expected SHA must be a full lowercase Git SHA");
}

const root = resolve(rootInput);
const manifestPath = join(root, ".release-integrity.json");
const requiredEntries = [
  ".next/BUILD_ID",
  ".next/build-manifest.json",
  ".next/prerender-manifest.json",
  ".next/required-server-files.json",
  ".next/routes-manifest.json",
  ".next/server",
  ".next/static",
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

function collectFiles(path, output) {
  if (!existsSync(path))
    fail(`required build output is missing: ${relative(root, path)}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink())
    fail(`symlinked build output is forbidden: ${relative(root, path)}`);
  if (stat.isFile()) {
    output.push(path);
    return;
  }
  if (!stat.isDirectory())
    fail(`unsupported build output type: ${relative(root, path)}`);
  for (const entry of readdirSync(path).sort()) {
    collectFiles(join(path, entry), output);
  }
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
  for (const entry of requiredEntries)
    collectFiles(join(root, entry), absoluteFiles);
  const uniqueFiles = [...new Set(absoluteFiles)].sort();
  const files = [];
  for (const path of uniqueFiles) {
    const relativePath = relative(root, path).split(sep).join("/");
    if (relativePath.startsWith("../"))
      fail("build output escaped release root");
    files.push({
      path: relativePath,
      size: lstatSync(path).size,
      sha256: await hashFile(path),
    });
  }
  return { version: 1, sha: expectedSha, files };
}

assertGitState();
const current = await snapshot();

if (mode === "write") {
  writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `[release-integrity] wrote ${current.files.length} hashes\n`,
  );
} else {
  let expected;
  try {
    expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("release integrity manifest is missing or invalid");
  }
  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    fail("release build output differs from its integrity manifest");
  }
  process.stdout.write(
    `[release-integrity] verified ${current.files.length} hashes\n`,
  );
}
