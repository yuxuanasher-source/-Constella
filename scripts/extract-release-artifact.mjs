#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, posix, resolve } from "node:path";
import { TextDecoder } from "node:util";

function fail(message) {
  process.stderr.write(`[extract-release-artifact] ${message}\n`);
  process.exit(1);
}

const [archiveInput, destinationInput, expectedArtifactSha256, expectedSha] =
  process.argv.slice(2);
if (!archiveInput || !isAbsolute(archiveInput)) {
  fail("release artifact path must be absolute");
}
if (!destinationInput || !isAbsolute(destinationInput)) {
  fail("release destination must be absolute");
}
if (!/^[0-9a-f]{64}$/.test(expectedArtifactSha256 ?? "")) {
  fail("trusted release artifact SHA-256 is required");
}
if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  fail("expected release SHA must be a full lowercase Git SHA");
}

const archivePath = resolve(archiveInput);
const destination = realpathSync(resolve(destinationInput));
if (basename(destination) !== expectedSha) {
  fail("release destination basename does not match the expected SHA");
}
const archiveStat = lstatSync(archivePath);
if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
  fail("release artifact must be a regular non-symlink file");
}
if (archiveStat.size <= 0 || archiveStat.size > 1024 * 1024 * 1024) {
  fail("release artifact size is outside the supported range");
}
if (
  existsSync(join(destination, ".next")) ||
  existsSync(join(destination, ".release-integrity.json"))
) {
  fail("release destination already contains runtime artifacts");
}

const archiveFd = openSync(archivePath, "r");
const openedArchiveStat = fstatSync(archiveFd);
if (
  openedArchiveStat.dev !== archiveStat.dev ||
  openedArchiveStat.ino !== archiveStat.ino ||
  openedArchiveStat.size !== archiveStat.size
) {
  fail("release artifact changed while opening");
}

const actualArtifactSha256 = await new Promise((resolveHash, rejectHash) => {
  const hash = createHash("sha256");
  const stream = createReadStream(archivePath, {
    fd: archiveFd,
    autoClose: false,
    start: 0,
  });
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", rejectHash);
  stream.on("end", () => resolveHash(hash.digest("hex")));
}).catch(() => "");
if (actualArtifactSha256 !== expectedArtifactSha256) {
  fail("release artifact does not match its trusted SHA-256");
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function readExact(position, length, label) {
  const buffer = Buffer.allocUnsafe(length);
  let consumed = 0;
  while (consumed < length) {
    const count = readSync(
      archiveFd,
      buffer,
      consumed,
      length - consumed,
      position + consumed,
    );
    if (count === 0) fail(`truncated tar ${label}`);
    consumed += count;
  }
  return buffer;
}

function decodeString(buffer) {
  const end = buffer.indexOf(0);
  const content = end === -1 ? buffer : buffer.subarray(0, end);
  try {
    return utf8.decode(content);
  } catch {
    fail("release artifact contains invalid UTF-8 metadata");
  }
}

function parseOctal(buffer, field) {
  const value = decodeString(buffer).trim();
  if (!/^[0-7]+$/.test(value)) fail(`invalid tar ${field}`);
  return Number.parseInt(value, 8);
}

function safeArchivePath(path) {
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    posix.normalize(path) !== path
  ) {
    fail(`unsafe release artifact path: ${path}`);
  }
  if (
    path !== ".release-integrity.json" &&
    path !== ".next/standalone" &&
    !path.startsWith(".next/standalone/")
  ) {
    fail(`unexpected release artifact path: ${path}`);
  }
}

function checksum(header) {
  let total = 0;
  for (let index = 0; index < header.length; index += 1) {
    total += index >= 148 && index < 156 ? 32 : header[index];
  }
  return total;
}

const entries = [];
const paths = new Set();
let offset = 0;
let zeroBlocks = 0;
while (offset + 512 <= openedArchiveStat.size) {
  const header = readExact(offset, 512, "header");
  offset += 512;
  if (header.every((byte) => byte === 0)) {
    zeroBlocks += 1;
    continue;
  }
  if (zeroBlocks > 0) fail("tar data appears after its end marker");
  const storedChecksum = parseOctal(header.subarray(148, 156), "checksum");
  if (checksum(header) !== storedChecksum) fail("tar header checksum mismatch");
  if (
    header.subarray(257, 263).toString("ascii") !== "ustar\u0000" ||
    header.subarray(263, 265).toString("ascii") !== "00"
  ) {
    fail("release artifact must use the POSIX ustar format");
  }
  const name = decodeString(header.subarray(0, 100));
  const prefix = decodeString(header.subarray(345, 500));
  const type = String.fromCharCode(header[156] || 48);
  const rawPath = prefix ? `${prefix}/${name}` : name;
  const path =
    type === "5" && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  safeArchivePath(path);
  if (paths.has(path)) fail(`duplicate release artifact path: ${path}`);
  paths.add(path);
  if (type !== "0" && type !== "5") {
    fail(`release artifact entry type is not allowed: ${path}`);
  }
  const size = parseOctal(header.subarray(124, 136), "size");
  const mode = parseOctal(header.subarray(100, 108), "mode");
  if (!Number.isSafeInteger(size) || size < 0) fail("invalid tar entry size");
  if (type === "5" && size !== 0) fail(`tar directory has content: ${path}`);
  if (offset + size > openedArchiveStat.size) {
    fail(`truncated tar entry: ${path}`);
  }
  entries.push({
    path,
    type,
    mode,
    contentOffset: offset,
    size,
  });
  offset += Math.ceil(size / 512) * 512;
}
if (offset !== openedArchiveStat.size || zeroBlocks < 2) {
  fail("release artifact lacks a complete tar end marker");
}
for (const required of [
  ".release-integrity.json",
  ".next/standalone/server.js",
  ".next/standalone/.release-sha",
]) {
  if (!paths.has(required)) fail(`release artifact is missing ${required}`);
}

const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
if (entryByPath.get(".release-integrity.json")?.type !== "0") {
  fail("release integrity manifest must be a regular file");
}
if (entryByPath.get(".next/standalone")?.type !== "5") {
  fail("standalone runtime root must be a directory");
}
for (const requiredFile of [
  ".next/standalone/server.js",
  ".next/standalone/.release-sha",
]) {
  if (entryByPath.get(requiredFile)?.type !== "0") {
    fail(`release artifact entry must be a regular file: ${requiredFile}`);
  }
}
for (const entry of entries) {
  const parts = entry.path.split("/");
  for (let length = 1; length < parts.length; length += 1) {
    const ancestor = entryByPath.get(parts.slice(0, length).join("/"));
    if (ancestor && ancestor.type !== "5") {
      fail(`release artifact path has a non-directory ancestor: ${entry.path}`);
    }
  }
}

const releaseShaEntry = entryByPath.get(".next/standalone/.release-sha");
if (
  releaseShaEntry.size !== expectedSha.length + 1 ||
  readExact(
    releaseShaEntry.contentOffset,
    releaseShaEntry.size,
    "release SHA",
  ).toString("utf8") !== `${expectedSha}\n`
) {
  fail("release artifact contains the wrong release SHA");
}
const manifestEntry = entryByPath.get(".release-integrity.json");
if (manifestEntry.size <= 0 || manifestEntry.size > 64 * 1024 * 1024) {
  fail(
    "release artifact integrity manifest size is outside the supported range",
  );
}
let releaseManifest;
try {
  releaseManifest = JSON.parse(
    readExact(
      manifestEntry.contentOffset,
      manifestEntry.size,
      "integrity manifest",
    ).toString("utf8"),
  );
} catch {
  fail("release artifact contains an invalid integrity manifest");
}
if (
  releaseManifest?.version !== 2 ||
  releaseManifest?.sha !== expectedSha ||
  !Array.isArray(releaseManifest?.files)
) {
  fail("release artifact integrity manifest is not bound to the expected SHA");
}

for (const entry of entries) {
  const output = join(destination, ...entry.path.split("/"));
  if (entry.type === "5") {
    mkdirSync(output, { recursive: true, mode: 0o750 });
    chmodSync(output, 0o750);
    continue;
  }
  mkdirSync(dirname(output), { recursive: true, mode: 0o750 });
  const mode =
    entry.path === ".release-integrity.json" ||
    entry.path === ".next/standalone/.release-sha"
      ? 0o600
      : entry.mode & 0o111
        ? 0o750
        : 0o640;
  const outputFd = openSync(output, "wx", mode);
  let remaining = entry.size;
  let sourcePosition = entry.contentOffset;
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, remaining || 1));
  while (remaining > 0) {
    const requested = Math.min(buffer.length, remaining);
    const count = readSync(archiveFd, buffer, 0, requested, sourcePosition);
    if (count === 0)
      fail(`truncated tar entry while extracting: ${entry.path}`);
    let written = 0;
    while (written < count) {
      written += writeSync(outputFd, buffer, written, count - written);
    }
    remaining -= count;
    sourcePosition += count;
  }
  closeSync(outputFd);
  chmodSync(output, mode);
}

const releaseShaPath = join(destination, ".next/standalone/.release-sha");
if (!statSync(releaseShaPath).isFile()) fail("release SHA was not extracted");
closeSync(archiveFd);
process.stdout.write(
  `[extract-release-artifact] extracted ${entries.length} trusted entries\n`,
);
