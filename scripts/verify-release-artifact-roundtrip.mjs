#!/usr/bin/env node

import { createServer } from "node:http";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

function fail(message) {
  throw new Error(`[verify-release-artifact-roundtrip] ${message}`);
}

const [
  artifactInput,
  expectedArtifactSha256,
  expectedManifestSha256,
  expectedSha,
] = process.argv.slice(2);
if (!artifactInput || !isAbsolute(artifactInput)) {
  fail("release artifact path must be absolute");
}
if (!/^[0-9a-f]{64}$/.test(expectedArtifactSha256 ?? "")) {
  fail("trusted artifact SHA-256 is required");
}
if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? "")) {
  fail("trusted manifest SHA-256 is required");
}
if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  fail("release SHA must be a full lowercase Git SHA");
}

const artifactPath = resolve(artifactInput);
const artifactStat = lstatSync(artifactPath);
if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
  fail("release artifact must be a regular non-symlink file");
}

const roundtripRoot = mkdtempSync(
  join(tmpdir(), "release-artifact-roundtrip-"),
);
const candidate = join(roundtripRoot, expectedSha);
const appPort = Number.parseInt(process.env.ROUNDTRIP_APP_PORT ?? "3999", 10);
if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) {
  fail("ROUNDTRIP_APP_PORT must be an unprivileged TCP port");
}

let worktreeCreated = false;
let appProcess;
let appStdout = "";
let appStderr = "";
let databaseStub;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(
      `${basename(command)} failed (${result.status}): ${
        result.stderr || result.stdout
      }`,
    );
  }
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    fail("database stub did not expose a TCP port");
  }
  return address.port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
  }
}

try {
  run("git", ["worktree", "add", "--detach", candidate, expectedSha]);
  worktreeCreated = true;
  run(process.execPath, [
    join(candidate, "scripts/extract-release-artifact.mjs"),
    artifactPath,
    candidate,
    expectedArtifactSha256,
    expectedSha,
  ]);
  run(process.execPath, [
    join(candidate, "scripts/release-integrity.mjs"),
    "verify",
    candidate,
    expectedSha,
    expectedManifestSha256,
  ]);

  databaseStub = createServer((request, response) => {
    if (request.url?.startsWith("/rest/v1/organizations")) {
      response.writeHead(200, { "content-range": "*/0" });
    } else {
      response.writeHead(404);
    }
    response.end();
  });
  const databasePort = await listen(databaseStub);

  appProcess = spawn(
    process.execPath,
    [join(candidate, ".next/standalone/server.js")],
    {
      cwd: candidate,
      env: {
        ...process.env,
        NODE_ENV: "production",
        NODE_PATH: join(
          candidate,
          ".next/standalone/node_modules/.pnpm/node_modules",
        ),
        PORT: String(appPort),
        HOSTNAME: "127.0.0.1",
        RELEASE_SHA: expectedSha,
        RELEASE_MANIFEST_SHA256: expectedManifestSha256,
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${databasePort}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-roundtrip-anon",
        SUPABASE_INTERNAL_URL: `http://127.0.0.1:${databasePort}`,
        SUPABASE_SERVICE_ROLE_KEY: "ci-roundtrip-service-role",
        ADMISSION_SHARE_CAPABILITY_SECRET: "ci-roundtrip-secret-0000000000000",
        XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  appProcess.stdout.setEncoding("utf8");
  appProcess.stderr.setEncoding("utf8");
  appProcess.stdout.on("data", (chunk) => {
    appStdout = `${appStdout}${chunk}`.slice(-16_384);
  });
  appProcess.stderr.on("data", (chunk) => {
    appStderr = `${appStderr}${chunk}`.slice(-16_384);
  });

  let health;
  let healthStatus;
  const healthDeadline = Date.now() + 30_000;
  while (Date.now() < healthDeadline) {
    if (appProcess.exitCode !== null) {
      fail(
        `standalone exited before health verification\n${appStdout}\n${appStderr}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      healthStatus = response.status;
      health = await response.json();
      if (response.ok && health?.ok === true) break;
    } catch {
      // The standalone server may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  if (
    health?.ok !== true ||
    health?.db !== true ||
    health?.release?.sha !== expectedSha ||
    health?.release?.manifestSha256 !== expectedManifestSha256
  ) {
    fail(
      `health proof failed (${healthStatus ?? "no response"}): ${JSON.stringify(
        health,
      )}\n${appStdout}\n${appStderr}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      sha: expectedSha,
      manifestSha256: expectedManifestSha256,
      artifactSha256: expectedArtifactSha256,
      health,
    })}\n`,
  );
} finally {
  await stopChild(appProcess);
  if (databaseStub) {
    databaseStub.closeAllConnections?.();
    await Promise.race([
      new Promise((resolveClose) => databaseStub.close(resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
  }
  if (worktreeCreated) {
    spawnSync("git", ["worktree", "remove", "--force", candidate], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
  }
  rmSync(roundtripRoot, { recursive: true, force: true });
}
