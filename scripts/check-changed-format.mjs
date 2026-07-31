#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { extname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const SUPPORTED_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
export const DIFF_FILTER = "ACMRT";

function fatal(message) {
  throw new Error(`[changed-format] ${message}`);
}

function git(root, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: options.buffer ? undefined : "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    fatal(`git ${args[0]} failed`);
  }
}

function commit(root, revision, label) {
  const value = git(root, ["rev-parse", "--verify", `${revision}^{commit}`])
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    fatal(`${label} did not resolve to a full Git SHA`);
  }
  return value;
}

export function collectChangedFiles(rootInput, baseRevision, headRevision) {
  const root = realpathSync(resolve(rootInput));
  const base = commit(root, baseRevision, "format base");
  const head = commit(root, headRevision, "format head");
  const mergeBase = git(root, ["merge-base", base, head]).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) {
    fatal("format merge-base is not a full Git SHA");
  }
  const output = git(
    root,
    [
      "diff",
      "--name-only",
      `--diff-filter=${DIFF_FILTER}`,
      "-z",
      mergeBase,
      head,
      "--",
    ],
    { buffer: true },
  );
  return output.toString("utf8").split("\0").filter(Boolean);
}

function isInside(root, path) {
  const offset = relative(root, path);
  return (
    offset !== "" &&
    offset !== ".." &&
    !offset.startsWith(`..${sep}`) &&
    !isAbsolute(offset)
  );
}

export function filterSupportedFiles(rootInput, files) {
  const root = realpathSync(resolve(rootInput));
  const supported = [];
  for (const rawPath of files) {
    const normalized = rawPath.replaceAll("\\", "/");
    if (
      normalized === "" ||
      normalized.startsWith("/") ||
      posix.normalize(normalized) !== normalized ||
      normalized.split("/").some((part) => part === "..")
    ) {
      fatal(`unsafe changed path: ${rawPath}`);
    }
    if (!SUPPORTED_EXTENSIONS.has(extname(normalized).toLowerCase())) continue;
    const absolute = resolve(root, ...normalized.split("/"));
    if (!isInside(root, absolute))
      fatal(`changed path escaped root: ${rawPath}`);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fatal(`changed path must be a regular non-symlink file: ${rawPath}`);
    }
    supported.push(normalized);
  }
  return supported;
}

export function prettierArguments(files) {
  return ["exec", "prettier", "--check", "--", ...files];
}

function runPrettier(root, files) {
  const args = prettierArguments(files);
  const npmExecPath = process.env.npm_execpath;
  const command =
    npmExecPath && /\.(?:c?js|mjs)$/i.test(npmExecPath)
      ? process.execPath
      : process.platform === "win32"
        ? "pnpm.cmd"
        : "pnpm";
  const commandArgs =
    command === process.execPath ? [npmExecPath, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fatal(`Prettier check failed with status ${result.status ?? "unknown"}`);
  }
}

export function main(rootInput = process.cwd(), env = process.env) {
  const root = realpathSync(resolve(rootInput));
  const explicitBase = env.FORMAT_BASE_SHA?.trim();
  if (explicitBase && !/^[0-9a-f]{40}$/i.test(explicitBase)) {
    fatal("FORMAT_BASE_SHA must be a full Git SHA");
  }
  const base =
    explicitBase ??
    commit(root, "origin/codex/full-project-ui", "remote default branch");
  const head = env.FORMAT_HEAD_SHA?.trim() || "HEAD";
  const changed = collectChangedFiles(root, base, head);
  const supported = filterSupportedFiles(root, changed);
  if (supported.length === 0) {
    process.stdout.write("[changed-format] PASS no supported files changed\n");
    return;
  }
  process.stdout.write(
    `[changed-format] checking ${supported.length} changed file(s)\n`,
  );
  runPrettier(root, supported);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
