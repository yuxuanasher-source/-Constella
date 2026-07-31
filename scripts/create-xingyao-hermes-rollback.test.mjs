import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const rollbackScript = join(
  repoRoot,
  "scripts/create-xingyao-hermes-rollback.sh",
);
const releaseIntegrity = join(repoRoot, "scripts/release-integrity.mjs");
const rollbackVerifier = join(
  repoRoot,
  "scripts/verify-xingyao-hermes-rollback-package.mjs",
);
const shellPath = (path) => {
  const normalized = path.replace(/\\/g, "/");
  if (process.platform !== "win32") return normalized;
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
};
const bashBin = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "bash",
].find((candidate) => candidate === "bash" || existsSync(candidate));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createRelease(releaseRoot, label) {
  const staging = mkdtempSync(join(releaseRoot, `${label}-`));
  const scripts = join(staging, "scripts");
  mkdirSync(join(staging, ".next/standalone"), { recursive: true });
  mkdirSync(join(staging, "supabase/migrations"), { recursive: true });
  mkdirSync(scripts, { recursive: true });
  writeFileSync(
    join(staging, ".next/standalone/server.js"),
    `process.stdout.write(${JSON.stringify(label)});\n`,
  );
  writeFileSync(
    join(staging, "ecosystem.config.cjs"),
    "module.exports = {};\n",
  );
  writeFileSync(
    join(scripts, "create-xingyao-hermes-rollback.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  writeFileSync(
    join(scripts, "deploy.sh"),
    [
      "#!/usr/bin/env bash",
      "validate_rollback_runtime() { :; }",
      "validate_secure_env_file() { :; }",
      "load_runtime_env() { :; }",
      "validate_rollback_control_paths() { :; }",
      "acquire_deploy_lock() { printf 'lock\\n' >> \"$CALLS_FILE\"; }",
      "load_previous_release() {",
      '  previous_sha="$PRODUCT_COMMIT"',
      '  previous_target="$RELEASE_ROOT/$PRODUCT_COMMIT"',
      '  previous_manifest_sha="$PRODUCT_MANIFEST_SHA256"',
      "}",
      'validate_release_capabilities() { [[ -d "$1" && "$2" == "$(basename "$1")" && "$3" =~ ^[0-9a-f]{64}$ ]]; }',
      'rollback_current() { printf \'switch:%s\\n\' "$previous_sha" >> "$CALLS_FILE"; }',
      'reload_pm2() { printf \'reload:%s\\n\' "$1" >> "$CALLS_FILE"; }',
      'verify_release() { printf \'verify:%s\\n\' "$1" >> "$CALLS_FILE"; }',
      "save_pm2() { printf 'save\\n' >> \"$CALLS_FILE\"; }",
      "",
    ].join("\n"),
  );
  for (const name of [
    "prepare-standalone-release.mjs",
    "release-integrity.mjs",
    "validate-expand-migration.mjs",
    "verify-xingyao-hermes-rollback-package.mjs",
  ]) {
    writeFileSync(join(scripts, name), "process.exit(0);\n");
  }
  writeFileSync(
    join(scripts, "verify-release.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  chmodSync(join(scripts, "verify-release.sh"), 0o755);
  writeFileSync(
    join(staging, "supabase/migrations/20260731000000_fixture.sql"),
    "-- deploy: expand\nselect 1;\n",
  );

  for (const args of [
    ["init", "--quiet", staging],
    ["-C", staging, "config", "user.name", "Rollback Contract"],
    ["-C", staging, "config", "user.email", "rollback@example.invalid"],
    ["-C", staging, "config", "core.autocrlf", "false"],
    ["-C", staging, "add", "."],
    ["-C", staging, "commit", "--quiet", "-m", `fixture ${label}`],
  ]) {
    const result = run("git", args);
    expect(result.status, result.stderr).toBe(0);
  }
  const rev = run("git", ["-C", staging, "rev-parse", "HEAD"]);
  expect(rev.status, rev.stderr).toBe(0);
  const commit = rev.stdout.trim();
  const release = join(releaseRoot, commit);
  renameSync(staging, release);
  const integrity = run(process.execPath, [
    releaseIntegrity,
    "write",
    release,
    commit,
  ]);
  expect(integrity.status, integrity.stderr).toBe(0);
  return {
    commit,
    manifestSha256: sha256(join(release, ".release-integrity.json")),
    release,
  };
}

describe("Xingyao Hermes atomic rollback package", () => {
  it("externally verifies a source-independent symlink rollback package", () => {
    const workspace = mkdtempSync(join(tmpdir(), "hermes-rollback-"));
    const releaseRoot = join(workspace, "releases");
    const outputDir = join(workspace, "rollback package's copy");
    const currentLink = join(workspace, "current release");
    const callsFile = join(workspace, "rollback-calls.log");
    const fakeBin = join(workspace, "bin");

    try {
      mkdirSync(releaseRoot, { recursive: true });
      mkdirSync(fakeBin);
      writeFileSync(
        join(fakeBin, "node"),
        '#!/usr/bin/env bash\nexec "$REAL_NODE_NATIVE" "$@"\n',
      );
      chmodSync(join(fakeBin, "node"), 0o755);
      const product = createRelease(releaseRoot, "product");
      const previous = createRelease(releaseRoot, "previous");
      symlinkSync(
        product.release,
        currentLink,
        process.platform === "win32" ? "junction" : "dir",
      );

      const result = run(
        bashBin,
        [
          shellPath(rollbackScript),
          "--release-root",
          shellPath(releaseRoot),
          "--current-link",
          shellPath(currentLink),
          "--output-dir",
          shellPath(outputDir),
          "--product-commit",
          product.commit,
          "--product-manifest-sha256",
          product.manifestSha256,
          "--previous-commit",
          previous.commit,
          "--previous-manifest-sha256",
          previous.manifestSha256,
          "--reason",
          "canary failed",
        ],
        {
          env: {
            ...process.env,
            PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
            REAL_NODE_NATIVE: shellPath(process.execPath),
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const manifest = readFileSync(join(outputDir, "manifest.txt"), "utf8");
      expect(manifest).toContain(`product_commit=${product.commit}`);
      expect(manifest).toContain(`previous_commit=${previous.commit}`);
      expect(manifest).toContain(
        `product_manifest_sha256=${product.manifestSha256}`,
      );
      expect(manifest).toContain(
        `previous_manifest_sha256=${previous.manifestSha256}`,
      );
      expect(manifest).toContain(`release_root=${shellPath(releaseRoot)}`);
      expect(manifest).toMatch(/sha256\([^)]+\)=\b[a-f0-9]{64}\b/);

      const rollbackCommand = readFileSync(
        join(outputDir, "rollback-command.sh"),
        "utf8",
      );
      expect(rollbackCommand).toContain("CURRENT_LINK=");
      expect(rollbackCommand).toContain("acquire_deploy_lock");
      expect(rollbackCommand).toContain("verify_release");
      expect(rollbackCommand).toContain("save_pm2");
      expect(rollbackCommand).toContain(
        'source "$PACKAGE_DIR/files/deploy.sh"',
      );
      expect(rollbackCommand).not.toContain(
        'source "$product_release/scripts/deploy.sh"',
      );
      expect(rollbackCommand).not.toContain("git reset --hard");
      expect(rollbackCommand).not.toContain("HERMES_ROLLBACK_OVERRIDE");

      const packageText = [
        manifest,
        rollbackCommand,
        readFileSync(join(outputDir, "files/deploy.sh"), "utf8"),
        readFileSync(join(outputDir, "files/release-integrity.mjs"), "utf8"),
        readFileSync(join(outputDir, "files/verify-release.sh"), "utf8"),
      ].join("\n");
      expect(packageText).not.toMatch(/sk-live-secret|api[_-]?key/i);

      const manifestHash = sha256(join(outputDir, "manifest.txt"));
      writeFileSync(
        join(product.release, "scripts/deploy.sh"),
        "#!/usr/bin/env bash\nprintf 'LIVE HELPER MUST NOT RUN\\n' >&2\nexit 99\n",
      );
      const verifierEnv = {
        ...process.env,
        EXPECTED_MANIFEST_SHA256: manifestHash,
        CALLS_FILE: shellPath(callsFile),
        PATH: `${dirname(bashBin)}${delimiter}${process.env.PATH}`,
      };
      const rollback = run(
        process.execPath,
        [rollbackVerifier, "execute", outputDir, manifestHash],
        { env: verifierEnv },
      );
      expect(rollback.status, rollback.stderr).toBe(0);
      expect(rollback.stderr).not.toContain("LIVE HELPER MUST NOT RUN");
      expect(readFileSync(callsFile, "utf8")).toBe(
        [
          "lock",
          `switch:${previous.commit}`,
          `reload:${previous.commit}`,
          `verify:${previous.commit}`,
          "save",
          "",
        ].join("\n"),
      );

      const callsBeforeTamper = readFileSync(callsFile, "utf8");
      writeFileSync(
        join(outputDir, "rollback-command.sh"),
        '#!/usr/bin/env bash\nprintf executed >> "$CALLS_FILE"\nexit 98\n',
      );
      const tampered = run(
        process.execPath,
        [rollbackVerifier, "execute", outputDir, manifestHash],
        { env: verifierEnv },
      );
      expect(tampered.status).not.toBe(0);
      expect(tampered.stderr).toMatch(/package file hash mismatch/i);
      expect(readFileSync(callsFile, "utf8")).toBe(callsBeforeTamper);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
