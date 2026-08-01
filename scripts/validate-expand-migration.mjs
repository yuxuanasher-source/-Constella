#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";

function fail(message) {
  process.stderr.write(`[validate-expand-migration] ${message}\n`);
  process.exit(1);
}

const file = process.argv[2];
if (!file) fail("migration path is required");

const source = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
const lines = source.split(/\r?\n/);
let headerLine = -1;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line.trim() === "") continue;
  if (/^--\s+deploy:\s+contract(?:\s|$)/.test(line)) {
    fail(
      `contract migration is forbidden in an application release: ${basename(file)}`,
    );
  }
  if (line === "-- deploy: expand") {
    headerLine = index;
    break;
  }
  fail(
    `first effective migration header must be exactly -- deploy: expand: ${basename(file)}`,
  );
}

if (headerLine === -1) fail(`migration is empty: ${basename(file)}`);

// psql executes files as a stream, so an in-file COMMIT/ROLLBACK or a psql
// meta-command could escape/control the wrapper transaction. Scan SQL tokens
// outside strings, quoted identifiers, dollar bodies, and comments, and reject
// transaction control only when it starts a top-level statement.
const sql = lines.slice(headerLine + 1).join("\n");
const forbidden = new Set([
  "abort",
  "begin",
  "commit",
  "end",
  "prepare",
  "rollback",
  "start",
]);
let index = 0;
let line = headerLine + 2;
let statementStart = true;
let state = "normal";
let blockDepth = 0;
let dollarTag = "";

while (index < sql.length) {
  const char = sql[index];
  const next = sql[index + 1] ?? "";

  if (state === "line-comment") {
    if (char === "\n") {
      state = "normal";
      line += 1;
    }
    index += 1;
    continue;
  }

  if (state === "block-comment") {
    if (char === "/" && next === "*") {
      blockDepth += 1;
      index += 2;
      continue;
    }
    if (char === "*" && next === "/") {
      blockDepth -= 1;
      index += 2;
      if (blockDepth === 0) state = "normal";
      continue;
    }
    if (char === "\n") {
      line += 1;
    }
    index += 1;
    continue;
  }

  if (state === "single-quote") {
    if (char === "'" && next === "'") {
      index += 2;
      continue;
    }
    if (char === "'") state = "normal";
    if (char === "\n") {
      line += 1;
    }
    index += 1;
    continue;
  }

  if (state === "double-quote") {
    if (char === '"' && next === '"') {
      index += 2;
      continue;
    }
    if (char === '"') state = "normal";
    if (char === "\n") {
      line += 1;
    }
    index += 1;
    continue;
  }

  if (state === "dollar-quote") {
    if (sql.startsWith(dollarTag, index)) {
      index += dollarTag.length;
      state = "normal";
      continue;
    }
    if (char === "\n") {
      line += 1;
    }
    index += 1;
    continue;
  }

  if (char === "\n") {
    line += 1;
    index += 1;
    continue;
  }
  if (/\s/.test(char)) {
    index += 1;
    continue;
  }
  if (char === "-" && next === "-") {
    state = "line-comment";
    index += 2;
    continue;
  }
  if (char === "/" && next === "*") {
    state = "block-comment";
    blockDepth = 1;
    index += 2;
    continue;
  }
  if (char === "\\") {
    fail(`psql meta-command is forbidden at ${basename(file)}:${line}`);
  }
  if (char === "'") {
    state = "single-quote";
    statementStart = false;
    index += 1;
    continue;
  }
  if (char === '"') {
    state = "double-quote";
    statementStart = false;
    index += 1;
    continue;
  }
  if (char === "$") {
    const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (match) {
      dollarTag = match[0];
      state = "dollar-quote";
      statementStart = false;
      index += dollarTag.length;
      continue;
    }
  }
  if (char === ";") {
    statementStart = true;
    index += 1;
    continue;
  }
  if (/[A-Za-z_]/.test(char)) {
    const tokenMatch = sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
    const token = tokenMatch[0];
    if (statementStart && forbidden.has(token.toLowerCase())) {
      fail(
        `top-level transaction control ${token} is forbidden at ${basename(file)}:${line}`,
      );
    }
    statementStart = false;
    index += token.length;
    continue;
  }

  statementStart = false;
  index += 1;
}

if (state !== "normal" && state !== "line-comment") {
  fail(`unterminated SQL quote or comment in ${basename(file)}`);
}
