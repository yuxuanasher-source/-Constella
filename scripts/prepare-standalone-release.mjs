#!/usr/bin/env node

import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(message) {
  process.stderr.write(`[prepare-standalone-release] ${message}\n`);
  process.exit(1);
}

const [rootInput, expectedSha] = process.argv.slice(2);
if (!rootInput || !isAbsolute(rootInput)) fail("release root must be absolute");
if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  fail("expected SHA must be a full lowercase Git SHA");
}

const root = realpathSync(resolve(rootInput));
const standalone = join(root, ".next/standalone");
const server = join(standalone, "server.js");
if (
  !existsSync(standalone) ||
  lstatSync(standalone).isSymbolicLink() ||
  !lstatSync(standalone).isDirectory()
) {
  fail("Next standalone root must be a real directory");
}
if (
  !existsSync(server) ||
  lstatSync(server).isSymbolicLink() ||
  !lstatSync(server).isFile()
) {
  fail("Next standalone server must be a regular file");
}

const copies = [
  [join(root, ".next/static"), join(standalone, ".next/static")],
  [join(root, "public"), join(standalone, "public")],
];
for (const [source, destination] of copies) {
  if (
    !existsSync(source) ||
    lstatSync(source).isSymbolicLink() ||
    !lstatSync(source).isDirectory()
  ) {
    fail(`required runtime directory is missing: ${source}`);
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
}

function validateRuntimeLinks(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(path);
    const relativeTarget = relative(root, target);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      fail(`standalone runtime symlink escaped the release: ${path}`);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path).sort()) {
    validateRuntimeLinks(join(path, entry));
  }
}

validateRuntimeLinks(standalone);
const materialized = `${standalone}.materialized`;
if (existsSync(materialized)) {
  fail(`stale materialized runtime path exists: ${materialized}`);
}
cpSync(standalone, materialized, {
  recursive: true,
  dereference: true,
  errorOnExist: true,
  force: false,
});
rmSync(standalone, { recursive: true, force: false });
renameSync(materialized, standalone);

function normalizeRuntimeTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    fail(`materialized standalone runtime still contains a symlink: ${path}`);
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      normalizeRuntimeTree(join(path, entry));
    }
    chmodSync(path, 0o750);
    return;
  }
  if (!stat.isFile()) fail(`unsupported runtime artifact: ${path}`);
  chmodSync(path, stat.mode & 0o111 ? 0o750 : 0o640);
}

normalizeRuntimeTree(standalone);
writeFileSync(join(standalone, ".release-sha"), `${expectedSha}\n`, {
  mode: 0o600,
});
process.stdout.write(
  "[prepare-standalone-release] runtime artifact prepared\n",
);
