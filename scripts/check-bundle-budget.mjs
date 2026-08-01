#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

function fatal(message) {
  process.stderr.write(`[bundle-budget] ${message}\n`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fatal(`cannot read ${label}: ${path}`);
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fatal(`${label} must be a positive integer`);
  }
  return value;
}

const [configInput, statsInput, rootInput] = process.argv.slice(2);
let root;
try {
  root = realpathSync(resolve(rootInput ?? process.cwd()));
} catch {
  fatal(`cannot resolve build root: ${rootInput ?? process.cwd()}`);
}
const configPath = resolve(
  configInput ?? join(root, "config/bundle-budgets.json"),
);
const statsPath = resolve(
  statsInput ?? join(root, ".next/diagnostics/route-bundle-stats.json"),
);
const budgets = readJson(configPath, "bundle budget config");
const stats = readJson(statsPath, "route bundle stats");

if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
  fatal("bundle budget config must be an object");
}
if (!Array.isArray(stats)) fatal("route bundle stats must be an array");

const maxClientChunkGzipBytes = positiveInteger(
  budgets.maxClientChunkGzipBytes,
  "maxClientChunkGzipBytes",
);
const routeBudgets = new Map();
for (const [key, value] of Object.entries(budgets)) {
  if (key === "maxClientChunkGzipBytes") continue;
  if (!key.startsWith("/")) fatal(`unknown bundle budget key: ${key}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fatal(`route budget must be an object: ${key}`);
  }
  const valueKeys = Object.keys(value);
  if (valueKeys.length !== 1 || valueKeys[0] !== "firstLoadGzipBytes") {
    fatal(`route budget has unknown fields: ${key}`);
  }
  routeBudgets.set(
    key,
    positiveInteger(value.firstLoadGzipBytes, `${key}.firstLoadGzipBytes`),
  );
}
if (routeBudgets.size === 0) fatal("at least one route budget is required");

const routeStats = new Map();
for (const entry of stats) {
  if (
    !entry ||
    typeof entry.route !== "string" ||
    !Array.isArray(entry.firstLoadChunkPaths)
  ) {
    fatal("route bundle stats contain an invalid entry");
  }
  if (routeStats.has(entry.route)) {
    fatal(`route bundle stats contain a duplicate route: ${entry.route}`);
  }
  routeStats.set(entry.route, entry);
}

const chunksRootInput = join(root, ".next/static/chunks");
let chunksRoot;
try {
  chunksRoot = realpathSync(chunksRootInput);
} catch {
  fatal(`cannot read client chunks directory: ${chunksRootInput}`);
}

function isWithin(child, parent) {
  const childRelative = relative(parent, child);
  return (
    childRelative !== "" &&
    childRelative !== ".." &&
    !childRelative.startsWith(`..${sep}`) &&
    !isAbsolute(childRelative)
  );
}

function clientChunkPath(rawPath) {
  if (typeof rawPath !== "string") {
    fatal("route bundle stats contain a non-string client chunk path");
  }
  const normalized = rawPath.replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    posix.normalize(normalized) !== normalized ||
    !normalized.startsWith(".next/static/chunks/")
  ) {
    fatal(`unsafe client chunk path: ${rawPath}`);
  }
  const candidate = resolve(root, ...normalized.split("/"));
  let physical;
  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      fatal(`client chunk must not be a symlink: ${rawPath}`);
    }
    physical = realpathSync(candidate);
  } catch {
    fatal(`cannot read client chunk: ${rawPath}`);
  }
  if (!isWithin(physical, chunksRoot) || !lstatSync(physical).isFile()) {
    fatal(`unsafe client chunk path: ${rawPath}`);
  }
  return physical;
}

const gzipSizes = new Map();
function gzipBytes(path) {
  if (!gzipSizes.has(path)) {
    gzipSizes.set(path, gzipSync(readFileSync(path)).byteLength);
  }
  return gzipSizes.get(path);
}

const failures = [];
for (const [route, budget] of routeBudgets) {
  const entry = routeStats.get(route);
  if (!entry) fatal(`configured route is missing from bundle stats: ${route}`);
  const chunks = [...new Set(entry.firstLoadChunkPaths.map(clientChunkPath))];
  if (chunks.length === 0) {
    fatal(`configured route has no first-load client chunks: ${route}`);
  }
  const actual = chunks.reduce((total, path) => total + gzipBytes(path), 0);
  const message = `${route} first-load gzip ${actual} <= ${budget} bytes`;
  if (actual > budget) failures.push(`FAIL ${message}`);
  else process.stdout.write(`[bundle-budget] PASS ${message}\n`);
}

function collectClientChunks(path, output) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fatal(`client chunks contain a symlink: ${path}`);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      collectClientChunks(join(path, entry), output);
    }
    return;
  }
  if (!stat.isFile()) fatal(`unsupported client chunk artifact: ${path}`);
  if (path.endsWith(".js")) output.push(path);
}

const clientChunks = [];
collectClientChunks(chunksRoot, clientChunks);
if (clientChunks.length === 0) fatal("no client JavaScript chunks were found");
const largest = clientChunks
  .map((path) => ({ path, bytes: gzipBytes(path) }))
  .sort((left, right) => right.bytes - left.bytes)[0];
const largestRelative = relative(root, largest.path).split(sep).join("/");
const largestMessage =
  `max client chunk ${largest.bytes} <= ${maxClientChunkGzipBytes} bytes ` +
  `(${largestRelative})`;
if (largest.bytes > maxClientChunkGzipBytes) {
  failures.push(`FAIL ${largestMessage}`);
} else {
  process.stdout.write(`[bundle-budget] PASS ${largestMessage}\n`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`[bundle-budget] ${failure}\n`);
  }
  process.exit(1);
}
