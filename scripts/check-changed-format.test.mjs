import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  collectChangedFiles,
  DIFF_FILTER,
  filterSupportedFiles,
  prettierArguments,
} from "./check-changed-format.mjs";

const nodeTestSpecifier = `node:${"test"}`;
const { test: rawTest } = process.env.VITEST
  ? await import("vitest")
  : await import(nodeTestSpecifier).then(({ default: nodeTest }) => ({
      test: nodeTest,
    }));

function test(name, handler) {
  const portableHandler = async (context = {}) => {
    const cleanups = [];
    const portableContext = {
      after(cleanup) {
        if (typeof context.after === "function") {
          context.after(cleanup);
        } else {
          cleanups.push(cleanup);
        }
      },
    };
    try {
      return await handler(portableContext);
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
    }
  };
  return process.env.VITEST
    ? rawTest(name, portableHandler)
    : rawTest(name, portableHandler);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "changed-format-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "format-test@example.invalid"]);
  git(root, ["config", "user.name", "Format Test"]);
  writeFileSync(join(root, "kept.ts"), "export const kept = true;\n");
  writeFileSync(join(root, "removed.ts"), "export const removed = true;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);

  writeFileSync(join(root, "kept.ts"), "export const kept={value:true}\n");
  writeFileSync(join(root, "strange name.md"), "# heading\n");
  writeFileSync(join(root, "image.png"), "not really an image\n");
  rmSync(join(root, "removed.ts"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "change"]);
  return { root, base, head: git(root, ["rev-parse", "HEAD"]) };
}

test("selects added, copied, modified, renamed, and type-changed files", (t) => {
  assert.equal(DIFF_FILTER, "ACMRT");
  const sample = repository(t);
  assert.deepEqual(collectChangedFiles(sample.root, sample.base, sample.head), [
    "image.png",
    "kept.ts",
    "strange name.md",
  ]);
  assert.deepEqual(
    filterSupportedFiles(sample.root, [
      "image.png",
      "kept.ts",
      "strange name.md",
    ]),
    ["kept.ts", "strange name.md"],
  );
});

test("passes exact paths after an option terminator without shell composition", () => {
  assert.deepEqual(prettierArguments(["-leading.ts", "line\nbreak.md"]), [
    "--check",
    "--",
    "-leading.ts",
    "line\nbreak.md",
  ]);
});

test("rejects backslash paths instead of aliasing distinct Git names", (t) => {
  const root = mkdtempSync(join(tmpdir(), "changed-format-backslash-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => filterSupportedFiles(root, ["a\\b.ts"]),
    /unsafe changed path/,
  );
});

test("rejects a changed supported-file symlink", (t) => {
  const root = mkdtempSync(join(tmpdir(), "changed-format-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "outside"));
  symlinkSync(
    join(root, "outside"),
    join(root, "linked.ts"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => filterSupportedFiles(root, ["linked.ts"]),
    /regular non-symlink file/,
  );
});
