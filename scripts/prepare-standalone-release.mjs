#!/usr/bin/env node

import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
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

function replaceAll(buffer, needle, replacement) {
  if (needle.length === 0) return buffer;
  const chunks = [];
  let cursor = 0;
  let match = buffer.indexOf(needle, cursor);
  if (match === -1) return buffer;
  while (match !== -1) {
    chunks.push(buffer.subarray(cursor, match), replacement);
    cursor = match + needle.length;
    match = buffer.indexOf(needle, cursor);
  }
  chunks.push(buffer.subarray(cursor));
  return Buffer.concat(chunks);
}

const buildRootVariants = [
  root,
  root.replaceAll("\\", "/"),
  JSON.stringify(root).slice(1, -1),
  JSON.stringify(root.replaceAll("\\", "/")).slice(1, -1),
]
  .filter((value, index, values) => values.indexOf(value) === index)
  .sort((left, right) => right.length - left.length)
  .map((value) => Buffer.from(value));
const canonicalRoot = Buffer.from(".");

function normalizeRuntimeTree(path) {
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
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      normalizeRuntimeTree(join(path, entry));
    }
    chmodSync(path, 0o750);
    return;
  }
  if (!stat.isFile()) fail(`unsupported runtime artifact: ${path}`);
  let contents = readFileSync(path);
  for (const variant of buildRootVariants) {
    contents = replaceAll(contents, variant, canonicalRoot);
  }
  writeFileSync(path, contents, {
    mode: stat.mode & 0o111 ? 0o750 : 0o640,
  });
  chmodSync(path, stat.mode & 0o111 ? 0o750 : 0o640);
}

normalizeRuntimeTree(standalone);
writeFileSync(join(standalone, ".release-sha"), `${expectedSha}\n`, {
  mode: 0o600,
});
process.stdout.write(
  "[prepare-standalone-release] runtime artifact prepared\n",
);
