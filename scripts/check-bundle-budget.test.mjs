import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const nodeTestSpecifier = `node:${"test"}`;
const { test: rawTest } = process.env.VITEST
  ? await import("vitest")
  : await import(nodeTestSpecifier).then(({ default: nodeTest }) => ({
      test: nodeTest,
    }));

function test(name, handler) {
  const portableHandler = async (context = {}) => {
    const localCleanups = [];
    const portableContext = {
      after(cleanup) {
        if (typeof context.after === "function") context.after(cleanup);
        else localCleanups.push(cleanup);
      },
    };
    try {
      return await handler(portableContext);
    } finally {
      for (const cleanup of localCleanups.reverse()) await cleanup();
    }
  };
  return process.env.VITEST
    ? rawTest(name, portableHandler, 30_000)
    : rawTest(name, portableHandler);
}

const checker = join(process.cwd(), "scripts/check-bundle-budget.mjs");

function fixture(t, { routeBytes = 1200, lazyBytes = 800 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bundle-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const chunks = join(root, ".next/static/chunks");
  const diagnostics = join(root, ".next/diagnostics");
  const config = join(root, "bundle-budgets.json");
  const stats = join(diagnostics, "route-bundle-stats.json");
  mkdirSync(chunks, { recursive: true });
  mkdirSync(diagnostics, { recursive: true });
  const routeChunk = join(chunks, "console.js");
  const lazyChunk = join(chunks, "lazy.js");
  writeFileSync(routeChunk, Buffer.alloc(routeBytes, 97));
  writeFileSync(lazyChunk, Buffer.alloc(lazyBytes, 98));
  writeFileSync(
    stats,
    `${JSON.stringify([
      {
        route: "/console",
        firstLoadUncompressedJsBytes: routeBytes,
        firstLoadChunkPaths: [".next\\static\\chunks\\console.js"],
      },
    ])}\n`,
  );
  return {
    root,
    config,
    stats,
    routeGzip: gzipSync(Buffer.alloc(routeBytes, 97)).byteLength,
    lazyGzip: gzipSync(Buffer.alloc(lazyBytes, 98)).byteLength,
  };
}

function run({ config, stats, root }) {
  return spawnSync(process.execPath, [checker, config, stats, root], {
    encoding: "utf8",
  });
}

test("passes when configured routes and every client chunk are within budget", (t) => {
  const sample = fixture(t);
  writeFileSync(
    sample.config,
    `${JSON.stringify({
      "/console": { firstLoadGzipBytes: sample.routeGzip },
      maxClientChunkGzipBytes: Math.max(sample.routeGzip, sample.lazyGzip),
    })}\n`,
  );

  const result = run(sample);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS \/console/);
  assert.match(result.stdout, /PASS max client chunk/);
});

test("fails closed when a route or lazy client chunk exceeds budget", (t) => {
  const sample = fixture(t);
  writeFileSync(
    sample.config,
    `${JSON.stringify({
      "/console": { firstLoadGzipBytes: sample.routeGzip - 1 },
      maxClientChunkGzipBytes: sample.lazyGzip - 1,
    })}\n`,
  );

  const result = run(sample);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAIL \/console/);
  assert.match(result.stderr, /FAIL max client chunk/);
});

test("fails closed for missing diagnostics and unsafe chunk paths", (t) => {
  const sample = fixture(t);
  writeFileSync(
    sample.config,
    `${JSON.stringify({
      "/console": { firstLoadGzipBytes: 1000 },
      maxClientChunkGzipBytes: 1000,
    })}\n`,
  );

  const missing = run({ ...sample, stats: join(sample.root, "missing.json") });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /cannot read route bundle stats/i);

  writeFileSync(
    sample.stats,
    `${JSON.stringify([
      {
        route: "/console",
        firstLoadChunkPaths: ["../outside.js"],
      },
    ])}\n`,
  );
  const unsafe = run(sample);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /unsafe client chunk path/i);
});
