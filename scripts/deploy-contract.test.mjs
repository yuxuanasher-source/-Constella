import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

// Keep the plan's `node --test` entrypoint while remaining compatible with the
// repository-wide Vitest glob. The computed Node specifier prevents Vite from
// trying to bundle node:test for its browser-oriented transform pipeline.
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
        if (typeof context.after === "function") {
          context.after(cleanup);
        } else {
          localCleanups.push(cleanup);
        }
      },
    };
    try {
      return await handler(portableContext);
    } finally {
      for (const cleanup of localCleanups.reverse()) await cleanup();
    }
  };
  return process.env.VITEST
    ? rawTest(name, portableHandler, 60_000)
    : rawTest(name, portableHandler);
}

const [
  deploy,
  verify,
  ecosystem,
  packageJson,
  legacyRollback,
  hermesRunbook,
  bootstrapRunbook,
  migrationValidator,
  artifactExtractor,
  standalonePreparer,
  ciWorkflow,
] = await Promise.all([
  readFile(join(process.cwd(), "scripts/deploy.sh"), "utf8"),
  readFile(join(process.cwd(), "scripts/verify-release.sh"), "utf8"),
  readFile(join(process.cwd(), "ecosystem.config.cjs"), "utf8"),
  readFile(join(process.cwd(), "package.json"), "utf8").then(JSON.parse),
  readFile(
    join(process.cwd(), "scripts/create-xingyao-hermes-rollback.sh"),
    "utf8",
  ),
  readFile(
    join(process.cwd(), "docs/runbooks/xingyao-hermes-gateway.md"),
    "utf8",
  ),
  readFile(
    join(process.cwd(), "docs/runbooks/atomic-release-bootstrap.md"),
    "utf8",
  ),
  readFile(
    join(process.cwd(), "scripts/validate-expand-migration.mjs"),
    "utf8",
  ),
  readFile(join(process.cwd(), "scripts/extract-release-artifact.mjs"), "utf8"),
  readFile(
    join(process.cwd(), "scripts/prepare-standalone-release.mjs"),
    "utf8",
  ),
  readFile(join(process.cwd(), ".github/workflows/ci.yml"), "utf8"),
]);

function position(source, marker) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `missing contract marker: ${marker}`);
  return index;
}

const bash =
  process.platform === "win32" &&
  existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";

function shellPath(path) {
  const normalized = path.replace(/\\/g, "/");
  if (process.platform !== "win32") return normalized;
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
}

function run(command, options = {}) {
  return spawnSync(command, options.args ?? [], {
    encoding: "utf8",
    ...options,
  });
}

async function writeExecutable(path, contents) {
  await writeFile(path, contents, { mode: 0o755 });
}

test("extracts the reviewed runtime before touching migrations or current", () => {
  const main = deploy.slice(position(deploy, "main() {"));
  const extract = position(main, "extract-release-artifact.mjs");
  const migrate = position(main, "apply_migrations");
  const switchCurrent = position(
    main,
    'log "Atomically switching current release',
  );

  assert.ok(extract < migrate, "artifact extraction must precede migrations");
  assert.ok(migrate < switchCurrent, "migrations must precede symlink switch");
  assert.doesNotMatch(main, /pnpm run build|pnpm install/);
  assert.match(
    main,
    /node "\$release_dir\/scripts\/extract-release-artifact\.mjs"/,
  );
  assert.match(
    deploy,
    /node "\$target\/scripts\/release-integrity\.mjs" verify/,
  );
  assert.match(
    deploy,
    /node "\$release_dir\/scripts\/validate-expand-migration\.mjs"/,
  );
  assert.match(deploy, /pg_advisory_xact_lock/);
  assert.match(deploy, /printf 'begin;\\n'/);
  assert.match(deploy, /printf 'commit;\\n'/);
  assert.match(migrationValidator, /-- deploy: expand/);
});

test("rolls the application symlink back and verifies the previous SHA", () => {
  assert.match(deploy, /rollback_current/);
  assert.match(deploy, /previous_target/);
  assert.match(deploy, /previous_sha/);
  assert.match(deploy, /verify-release\.sh[\s\S]*\"\$previous_sha\"/);
  assert.match(
    deploy,
    /does not roll back|does not revert|不会回滚|不回滚/i,
    "rollback must explicitly preserve already-applied expand migrations",
  );
});

test("recreates PM2 from an ecosystem file and verifies the release", () => {
  const activation = deploy.slice(position(deploy, "reload_pm2() {"));
  const reload = position(activation, "pm2_bounded startOrReload");
  const verification = position(activation, "verify-release.sh");
  assert.ok(reload < verification, "verification must follow PM2 reload");

  assert.match(ecosystem, /cwd:\s*process\.env\.CURRENT_LINK/);
  assert.match(ecosystem, /script:\s*["']\.next\/standalone\/server\.js["']/);
  assert.match(ecosystem, /interpreter:\s*process\.execPath/);
  assert.match(ecosystem, /RELEASE_SHA:\s*process\.env\.RELEASE_SHA/);
  assert.match(ecosystem, /RELEASE_MANIFEST_SHA256/);
});

test("verifier checks health, full SHA, PM2 state, cwd, script, and current target", () => {
  assert.match(verify, /curl[\s\S]*--fail[\s\S]*--retry/);
  assert.match(verify, /release\.sha/);
  assert.match(verify, /EXPECTED_SHA/);
  assert.match(verify, /pm2 jlist/);
  assert.match(verify, /online/);
  assert.match(verify, /pm_cwd/);
  assert.match(verify, /pm_exec_path/);
  assert.match(verify, /CURRENT_LINK/);
});

test("deployment validates absolute paths and rejects dangerous roots", () => {
  assert.match(deploy, /require_absolute_path/);
  assert.match(deploy, /reject_dangerous_path/);
  for (const dangerous of ['"/"', '"/var"', '"/var/cache"', '"$HOME"']) {
    assert.ok(
      deploy.includes(dangerous),
      `must reject dangerous path ${dangerous}`,
    );
  }
  assert.match(deploy, /SOURCE_REPO/);
  assert.match(deploy, /RELEASE_ROOT/);
  assert.match(deploy, /release_dir/);
});

test("path validation preserves CURRENT_LINK and loads its managed target", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-contract-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const sourceRepo = join(sandbox, "source");
  const releaseRoot = join(sandbox, "releases");
  const targetSha = "a".repeat(40);
  const target = join(releaseRoot, targetSha);
  const candidateSha = "b".repeat(40);
  const candidate = join(releaseRoot, candidateSha);
  const currentLink = join(sandbox, "current");
  await mkdir(sourceRepo);
  await mkdir(target, { recursive: true });
  await mkdir(candidate, { recursive: true });
  await mkdir(join(target, "scripts"), { recursive: true });
  await mkdir(join(target, "app/api/health"), { recursive: true });
  await writeFile(
    join(target, "ecosystem.config.cjs"),
    "module.exports = {};\n",
  );
  await writeExecutable(
    join(target, "scripts/verify-release.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  await writeFile(
    join(target, "app/api/health/route.ts"),
    "const sha = process.env.RELEASE_SHA;\n",
  );
  await symlink(
    target,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );

  const initialized = run("git", { args: ["init", "--quiet", sourceRepo] });
  assert.equal(initialized.status, 0, initialized.stderr);

  const deployPath = join(process.cwd(), "scripts/deploy.sh");
  const shell = run(bash, {
    args: [
      "-lc",
      `set -euo pipefail
SOURCE_REPO="$(cygpath -u "$SOURCE_NATIVE" 2>/dev/null || printf '%s' "$SOURCE_NATIVE")"
RELEASE_ROOT="$(cygpath -u "$RELEASE_NATIVE" 2>/dev/null || printf '%s' "$RELEASE_NATIVE")"
CURRENT_LINK="$(cygpath -u "$CURRENT_NATIVE" 2>/dev/null || printf '%s' "$CURRENT_NATIVE")"
deploy_script="$(cygpath -u "$DEPLOY_NATIVE" 2>/dev/null || printf '%s' "$DEPLOY_NATIVE")"
source "$deploy_script"
validate_release_capabilities() { validate_release_path "$1"; }
read_pm2_release_manifest_sha() { printf '%s' "${"e".repeat(64)}"; }
TRUSTED_CURRENT_SHA="${targetSha}"
TRUSTED_CURRENT_MANIFEST_SHA256="${"e".repeat(64)}"
expected_link="$(lexical_path "$CURRENT_LINK")"
validate_control_paths
load_previous_release
[[ "$CURRENT_LINK" == "$expected_link" ]]
[[ "$previous_target" == "$RELEASE_ROOT/${targetSha}" ]]
[[ "$previous_sha" == "${targetSha}" ]]
release_dir="$RELEASE_ROOT/${candidateSha}"
case "$(uname -s)" in
  MINGW*) ;; # Git Bash emulates directory links and cannot exercise mv -T.
  *)
    atomic_switch_current
    [[ "$(physical_path "$CURRENT_LINK")" == "$release_dir" ]]
    rollback_current
    [[ "$(physical_path "$CURRENT_LINK")" == "$previous_target" ]]
    ;;
esac`,
    ],
    env: {
      ...process.env,
      SOURCE_NATIVE: sourceRepo,
      RELEASE_NATIVE: releaseRoot,
      CURRENT_NATIVE: currentLink,
      DEPLOY_NATIVE: deployPath,
    },
  });
  assert.equal(shell.status, 0, `${shell.stdout}\n${shell.stderr}`);
});

test("artifact extraction failure leaves database, PM2, and current release untouched", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-build-failure-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const sourceRepo = join(sandbox, "source");
  const releaseRoot = join(sandbox, "releases");
  const fakeBin = join(sandbox, "bin");
  const callsFile = join(sandbox, "calls.log");
  const envFile = join(sandbox, "production.env");
  const releaseArtifact = join(sandbox, "release-runtime.tar");
  const previousSha = "a".repeat(40);
  const targetSha = "b".repeat(40);
  const previousTarget = join(releaseRoot, previousSha);
  const currentLink = join(sandbox, "current");
  const testLock = join(sandbox, "deploy.lock");
  const testManifestSha = "e".repeat(64);
  const deployUnderTest = join(sandbox, "deploy-under-test.sh");
  await mkdir(join(sourceRepo, ".git"), { recursive: true });
  await mkdir(previousTarget, { recursive: true });
  await mkdir(fakeBin);
  await writeFile(callsFile, "");
  await writeFile(releaseArtifact, "trusted fixture artifact\n");
  await mkdir(join(previousTarget, "scripts"), { recursive: true });
  await mkdir(join(previousTarget, "app/api/health"), { recursive: true });
  await writeFile(
    join(previousTarget, "ecosystem.config.cjs"),
    "module.exports = {};\n",
  );
  await writeExecutable(
    join(previousTarget, "scripts/verify-release.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  await writeFile(
    join(previousTarget, "scripts/release-integrity.mjs"),
    "process.exit(0);\n",
  );
  await writeFile(join(previousTarget, ".release-integrity.json"), "{}\n");
  await writeFile(
    join(previousTarget, "app/api/health/route.ts"),
    "const sha = process.env.RELEASE_SHA;\n",
  );
  await symlink(
    previousTarget,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(
    deployUnderTest,
    deploy
      .replace(
        'readonly LOCK_FILE="/var/lock/jingying-cabin/deploy.lock"',
        `readonly LOCK_FILE="${shellPath(testLock)}"`,
      )
      .replace(
        /read_pm2_release_manifest_sha\(\) \{[\s\S]*?\n\}\n\nsafe_remove_release_dir/,
        `read_pm2_release_manifest_sha() { printf '%s' "${testManifestSha}"; }\n\nsafe_remove_release_dir`,
      ),
  );
  await writeFile(join(sandbox, "release-integrity.mjs"), "process.exit(0);\n");
  await writeFile(
    join(sandbox, "extract-release-artifact.mjs"),
    "process.exit(Number(process.env.EXTRACT_STATUS ?? 0));\n",
  );

  await writeExecutable(
    join(fakeBin, "git"),
    `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> "$CALLS_FILE"
if [[ "$1" == "-C" ]]; then REPO="$2"; shift 2; fi
case "$1 $2" in
  "rev-parse --show-toplevel") printf '%s\\n' "$REPO" ;;
  "rev-parse origin/"*) printf '%s\\n' "$FAKE_TARGET_SHA" ;;
  "rev-parse HEAD") basename "$REPO" ;;
  "diff --quiet"|"diff --cached") exit 0 ;;
  "worktree add")
    mkdir -p -- "$4/scripts"
    cp -- "$FAKE_EXTRACTOR" "$4/scripts/extract-release-artifact.mjs"
    ;;
  "worktree remove") exit 1 ;;
  *) exit 0 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "node"),
    `#!/usr/bin/env bash
if [[ "$1" == "-p" ]]; then printf '20\\n'; else exec "$REAL_NODE" "$@"; fi
`,
  );
  await writeExecutable(
    join(fakeBin, "stat"),
    `#!/usr/bin/env bash
if [[ "\${FAKE_INSECURE_ENV:-0}" == 1 && "$2" == "%a" && "$4" == "$ENV_FILE" ]]; then
  printf '666\n'
else
  /usr/bin/stat "$@"
fi
`,
  );
  for (const command of ["docker", "curl", "flock"]) {
    await writeExecutable(
      join(fakeBin, command),
      `#!/usr/bin/env bash
printf '${command} %s\\n' "$*" >> "$CALLS_FILE"
`,
    );
  }
  await writeExecutable(
    join(fakeBin, "pm2"),
    `#!/usr/bin/env bash
printf 'pm2 %s\\n' "$*" >> "$CALLS_FILE"
if [[ "$1" == "jlist" ]]; then
  printf '[{"name":"jingying-cabin","pm2_env":{"RELEASE_SHA":"%s","RELEASE_MANIFEST_SHA256":"%s","pm_cwd":"%s"}}]\\n' \
    "$PREVIOUS_SHA" "$PREVIOUS_MANIFEST_SHA" "$PREVIOUS_TARGET"
fi
`,
  );

  const invoke = (extraEnv = {}) =>
    run(bash, {
      args: [
        "-lc",
        `set -uo pipefail
native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
export SOURCE_REPO="$(native_to_unix "$SOURCE_NATIVE")"
export RELEASE_ROOT="$(native_to_unix "$RELEASE_NATIVE")"
export CURRENT_LINK="$(native_to_unix "$CURRENT_NATIVE")"
export ENV_FILE="$(native_to_unix "$ENV_NATIVE")"
export CALLS_FILE="$(native_to_unix "$CALLS_NATIVE")"
export FAKE_TARGET_SHA="${targetSha}"
export EXPECTED_SHA="\${EXPECTED_SHA_OVERRIDE:-${targetSha}}"
export EXPECTED_RELEASE_MANIFEST_SHA256="${testManifestSha}"
export RELEASE_ARTIFACT_PATH="$(native_to_unix "$ARTIFACT_NATIVE")"
export EXPECTED_RELEASE_ARTIFACT_SHA256="${"d".repeat(64)}"
export TRUSTED_CURRENT_SHA="${previousSha}"
export TRUSTED_CURRENT_MANIFEST_SHA256="${testManifestSha}"
export REAL_NODE="$(native_to_unix "$REAL_NODE_NATIVE")"
export FAKE_EXTRACTOR="$(native_to_unix "$EXTRACTOR_NATIVE")"
export PREVIOUS_TARGET="$(native_to_unix "$PREVIOUS_NATIVE")"
export PREVIOUS_SHA="${previousSha}"
export PREVIOUS_MANIFEST_SHA="${testManifestSha}"
export PATH="$(native_to_unix "$BIN_NATIVE"):$PATH"
deploy_script="$(native_to_unix "$DEPLOY_NATIVE")"
bash "$deploy_script"`,
      ],
      env: {
        ...process.env,
        SOURCE_NATIVE: sourceRepo,
        RELEASE_NATIVE: releaseRoot,
        CURRENT_NATIVE: currentLink,
        ENV_NATIVE: envFile,
        CALLS_NATIVE: callsFile,
        BIN_NATIVE: fakeBin,
        DEPLOY_NATIVE: deployUnderTest,
        REAL_NODE_NATIVE: process.execPath,
        EXTRACTOR_NATIVE: join(sandbox, "extract-release-artifact.mjs"),
        PREVIOUS_NATIVE: previousTarget,
        ARTIFACT_NATIVE: releaseArtifact,
        ...extraEnv,
      },
    });

  const missingEnv = invoke();
  assert.notEqual(missingEnv.status, 0);
  assert.match(missingEnv.stderr, /ENV_FILE is missing/);
  assert.equal(await readFile(callsFile, "utf8"), "");

  await writeFile(
    envFile,
    [
      "POSTGREST_READY_URL=http://127.0.0.1:3001/ready",
      "POSTGREST_METRICS_URL=http://127.0.0.1:3001/metrics",
      "POSTGREST_SCHEMA_CACHE_URL=http://127.0.0.1:3001/schema_cache",
      "",
    ].join("\n"),
    {
      mode: 0o640,
    },
  );
  const unsafeEnv = invoke({ FAKE_INSECURE_ENV: "1" });
  assert.notEqual(unsafeEnv.status, 0);
  assert.match(unsafeEnv.stderr, /group\/world writable/);
  assert.equal(await readFile(callsFile, "utf8"), "");

  const movedHead = invoke({ EXPECTED_SHA_OVERRIDE: "c".repeat(40) });
  assert.notEqual(movedHead.status, 0);
  assert.match(movedHead.stderr, /branch head moved/);
  const movedCalls = await readFile(callsFile, "utf8");
  assert.doesNotMatch(
    movedCalls,
    /worktree add|pnpm |docker |pm2 (?:start|reload|save|delete)/,
  );
  await writeFile(callsFile, "");

  const shell = invoke({ EXTRACT_STATUS: "17" });
  assert.notEqual(
    shell.status,
    0,
    "the simulated artifact extraction must fail",
  );

  const calls = await readFile(callsFile, "utf8");
  assert.match(calls, /worktree add/);
  assert.doesNotMatch(calls, /pnpm /);
  assert.doesNotMatch(calls, /^docker /m);
  assert.doesNotMatch(calls, /^pm2 (?:start|reload|save|delete)/m);
  const linkedTarget = await readlink(currentLink);
  assert.equal(resolve(linkedTarget), resolve(previousTarget));
});

test("migration enumeration failure cannot switch current or call PM2", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-enumeration-failure-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const migrations = join(sandbox, "migrations");
  const output = join(sandbox, "manifest");
  const calls = join(sandbox, "calls.log");
  const currentTarget = join(sandbox, "current-target");
  const currentLink = join(sandbox, "current");
  await mkdir(migrations);
  await mkdir(currentTarget);
  await writeFile(calls, "");
  await writeFile(
    join(migrations, "20260731000000_failure.sql"),
    "-- deploy: expand\nselect 1;\n",
  );
  await symlink(
    currentTarget,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );
  const deployPath = join(process.cwd(), "scripts/deploy.sh");
  const shell = run(bash, {
    args: [
      "-lc",
      `native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
export CALLS_FILE="$(native_to_unix "$CALLS_NATIVE")"
source "$(native_to_unix "$DEPLOY_NATIVE")"
find() { printf 'find %s\\n' "$*" >> "$CALLS_FILE"; return 71; }
pm2() { printf 'pm2 %s\\n' "$*" >> "$CALLS_FILE"; return 0; }
write_migration_manifest "$(native_to_unix "$MIGRATIONS_NATIVE")" "$(native_to_unix "$OUTPUT_NATIVE")"`,
    ],
    env: {
      ...process.env,
      CALLS_NATIVE: calls,
      DEPLOY_NATIVE: deployPath,
      MIGRATIONS_NATIVE: migrations,
      OUTPUT_NATIVE: output,
    },
  });
  assert.notEqual(shell.status, 0, "enumeration failure must be fatal");
  const recordedCalls = await readFile(calls, "utf8");
  assert.match(recordedCalls, /^find /m, shell.stderr);
  assert.doesNotMatch(recordedCalls, /^pm2 /m);
  assert.equal(resolve(await readlink(currentLink)), resolve(currentTarget));
});

test("expand validator rejects transaction escape and psql control", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "expand-validator-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const validator = join(
    process.cwd(),
    "scripts/validate-expand-migration.mjs",
  );
  const migration = join(sandbox, "20260731000000_validator.sql");

  await writeFile(
    migration,
    `-- deploy: expand
create or replace function public.safe_expand_probe()
returns void language plpgsql as $$
begin
  perform 1;
end;
$$;
select 'commit and rollback are data here';
`,
  );
  const valid = run(process.execPath, { args: [validator, migration] });
  assert.equal(valid.status, 0, valid.stderr);

  for (const [body, expected] of [
    ["select 1;\nCOMMIT;\n", /top-level transaction control/i],
    ["  \\set unsafe 1\nselect 1;\n", /psql meta-command/i],
    ["select 'commit;' \\gexec\n", /psql meta-command/i],
    [
      "PREPARE TRANSACTION 'escape-wrapper';\n",
      /top-level transaction control/i,
    ],
  ]) {
    await writeFile(migration, `-- deploy: expand\n${body}`);
    const invalid = run(process.execPath, { args: [validator, migration] });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, expected);
  }
});

test("a second deployment fails immediately while the host lock is held", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-lock-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const releaseRoot = join(sandbox, "releases");
  const fakeBin = join(sandbox, "bin");
  const lockState = join(sandbox, "flock-held");
  await mkdir(releaseRoot);
  await mkdir(fakeBin);
  await writeExecutable(
    join(fakeBin, "flock"),
    `#!/usr/bin/env bash
mkdir "$FAKE_FLOCK_STATE" 2>/dev/null
`,
  );
  const deployPath = join(process.cwd(), "scripts/deploy.sh");
  const shellScript = `native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
export PATH="$(native_to_unix "$BIN_NATIVE"):$PATH"
export FAKE_FLOCK_STATE="$(native_to_unix "$LOCK_STATE_NATIVE")"
source "$(native_to_unix "$DEPLOY_NATIVE")"
acquire_deploy_lock_at "$(native_to_unix "$LOCK_NATIVE")"`;
  const env = {
    ...process.env,
    BIN_NATIVE: fakeBin,
    RELEASE_NATIVE: releaseRoot,
    LOCK_NATIVE: join(releaseRoot, ".deploy.lock"),
    LOCK_STATE_NATIVE: lockState,
    DEPLOY_NATIVE: deployPath,
  };
  const first = run(bash, { args: ["-lc", shellScript], env });
  assert.equal(first.status, 0, first.stderr);

  const second = run(bash, { args: ["-lc", shellScript], env });
  assert.notEqual(second.status, 0, "concurrent deployment must fail");
  assert.match(second.stderr, /another deployment already holds/);
});

test("real Linux flock excludes a concurrent deployment process", async (t) => {
  if (process.platform === "win32") return;
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-real-flock-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const lock = join(sandbox, "deploy.lock");
  const ready = join(sandbox, "ready");
  const deployPath = join(process.cwd(), "scripts/deploy.sh");
  const holder = spawn(
    bash,
    [
      "-lc",
      `source "$DEPLOY_NATIVE"
acquire_deploy_lock_at "$LOCK_NATIVE"
printf held > "$READY_NATIVE"
sleep 10`,
    ],
    {
      env: {
        ...process.env,
        DEPLOY_NATIVE: deployPath,
        LOCK_NATIVE: lock,
        READY_NATIVE: ready,
      },
      stdio: "ignore",
    },
  );
  t.after(() => holder.kill("SIGKILL"));
  for (let attempt = 0; attempt < 50 && !existsSync(ready); attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.ok(existsSync(ready), "first process did not acquire the real flock");
  const contender = run(bash, {
    args: [
      "-lc",
      `source "$DEPLOY_NATIVE"; acquire_deploy_lock_at "$LOCK_NATIVE"`,
    ],
    env: {
      ...process.env,
      DEPLOY_NATIVE: deployPath,
      LOCK_NATIVE: lock,
    },
  });
  assert.notEqual(contender.status, 0);
  assert.match(contender.stderr, /another deployment already holds/);
});

test("PM2 timeout enforces a hard kill deadline", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-pm2-timeout-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const fakeBin = join(sandbox, "bin");
  await mkdir(fakeBin);
  await writeExecutable(
    join(fakeBin, "pm2"),
    "#!/usr/bin/env bash\ntrap '' TERM\nwhile :; do sleep 1; done\n",
  );
  const started = Date.now();
  const result = run(bash, {
    args: [
      "-lc",
      `PATH="$(cygpath -u "$BIN_NATIVE" 2>/dev/null || printf '%s' "$BIN_NATIVE"):$PATH"
source "$DEPLOY_NATIVE"
PM2_TIMEOUT_SECONDS=1
pm2_bounded jlist`,
    ],
    env: {
      ...process.env,
      BIN_NATIVE: fakeBin,
      DEPLOY_NATIVE: join(process.cwd(), "scripts/deploy.sh"),
    },
    timeout: 8_000,
  });
  assert.notEqual(result.status, 0);
  assert.ok(Date.now() - started < 7_000, "PM2 timeout exceeded hard deadline");
});

test("database lease acquisition has a bounded response deadline", () => {
  const started = Date.now();
  const result = run(bash, {
    args: [
      "-lc",
      `source "$DEPLOY_NATIVE"
DATABASE_LEASE_WAIT_SECONDS=1
DB_RESPONSE_TIMEOUT_SECONDS=1
DATABASE_LEASE_SESSION_TIMEOUT_SECONDS=30
db_lease_session() {
  trap '' TERM
  while :; do sleep 1; done
}
acquire_database_deploy_lease`,
    ],
    env: {
      ...process.env,
      DEPLOY_NATIVE: join(process.cwd(), "scripts/deploy.sh"),
    },
    timeout: 20_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lease response timed out/);
  assert.ok(
    Date.now() - started < 15_000,
    "database lease acquisition exceeded its hard cleanup deadline",
  );
});

test("rollback preserves both releases until old reload, verify, and save succeed", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-rollback-state-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const callsFile = join(sandbox, "calls.log");
  await writeFile(callsFile, "");
  const deployPath = join(process.cwd(), "scripts/deploy.sh");
  const invoke = (mode) =>
    run(bash, {
      args: [
        "-lc",
        `CALLS_FILE="$(cygpath -u "$CALLS_NATIVE" 2>/dev/null || printf '%s' "$CALLS_NATIVE")"
source "$(cygpath -u "$DEPLOY_NATIVE" 2>/dev/null || printf '%s' "$DEPLOY_NATIVE")"
previous_sha="${"a".repeat(40)}"
candidate_pm2_may_be_active=1
rollback_current() { printf 'rollback\\n' >> "$CALLS_FILE"; }
reload_pm2() { printf 'reload\\n' >> "$CALLS_FILE"; [[ "$FAIL_MODE" != reload ]]; }
verify_release() { printf 'verify\\n' >> "$CALLS_FILE"; [[ "$FAIL_MODE" != verify ]]; }
save_pm2() { printf 'save\\n' >> "$CALLS_FILE"; [[ "$FAIL_MODE" != save ]]; }
if rollback_after_activation_failure; then result=success; else result=failure; fi
printf 'result=%s active=%s\\n' "$result" "$candidate_pm2_may_be_active"`,
      ],
      env: {
        ...process.env,
        CALLS_NATIVE: callsFile,
        DEPLOY_NATIVE: deployPath,
        FAIL_MODE: mode,
      },
    });

  const reloadFailure = invoke("reload");
  assert.equal(reloadFailure.status, 0, reloadFailure.stderr);
  assert.match(reloadFailure.stdout, /result=failure active=1/);
  assert.equal(await readFile(callsFile, "utf8"), "rollback\nreload\n");

  await writeFile(callsFile, "");
  const verifyFailure = invoke("verify");
  assert.match(verifyFailure.stdout, /result=failure active=1/);
  assert.equal(await readFile(callsFile, "utf8"), "rollback\nreload\nverify\n");

  await writeFile(callsFile, "");
  const saveFailure = invoke("save");
  assert.match(saveFailure.stdout, /result=failure active=1/);
  assert.equal(
    await readFile(callsFile, "utf8"),
    "rollback\nreload\nverify\nsave\n",
  );

  await writeFile(callsFile, "");
  const success = invoke("none");
  assert.match(success.stdout, /result=success active=0/);
  assert.equal(
    await readFile(callsFile, "utf8"),
    "rollback\nreload\nverify\nsave\n",
  );
});

test("release verifier accepts only the exact healthy runtime SHA", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "verify-release-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const releaseRoot = join(sandbox, "releases");
  const fakeBin = join(sandbox, "bin");
  const expectedSha = "c".repeat(40);
  const currentTarget = join(releaseRoot, expectedSha);
  const currentLink = join(sandbox, "current");
  const expectedManifest = "e".repeat(64);
  const standaloneServer = join(currentTarget, ".next/standalone/server.js");
  await mkdir(currentTarget, { recursive: true });
  await mkdir(join(currentTarget, "scripts"), { recursive: true });
  await mkdir(join(currentTarget, ".next/standalone"), { recursive: true });
  await writeFile(standaloneServer, "process.exit(0);\n");
  await mkdir(fakeBin);
  await writeFile(
    join(currentTarget, "scripts/release-integrity.mjs"),
    "process.exit(0);\n",
  );
  await symlink(
    currentTarget,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );

  await writeExecutable(
    join(fakeBin, "curl"),
    `#!/usr/bin/env bash
printf '{"ok":true,"release":{"sha":"%s","manifestSha256":"%s"}}\\n' \
  "$FAKE_HEALTH_SHA" "$FAKE_MANIFEST_SHA"
`,
  );
  await writeExecutable(
    join(fakeBin, "node"),
    `#!/usr/bin/env bash
exec "$REAL_NODE" "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "pm2"),
    `#!/usr/bin/env bash
[[ "$1" == "jlist" ]] || exit 2
node -e '
  const [name,cwd,sha,manifest,server,interpreter,mode]=process.argv.slice(1);
  const entry={name,pm2_env:{status:"online",RELEASE_SHA:sha,RELEASE_MANIFEST_SHA256:manifest,pm_cwd:cwd,pm_exec_path:server,exec_interpreter:interpreter,args:[]}};
  if (mode === "args") entry.pm2_env.args=["--bad"];
  const entries=[entry];
  if (mode === "stale-instance") entries.push({name,pm2_env:{...entry.pm2_env,RELEASE_SHA:"d".repeat(40)}});
  console.log(JSON.stringify(entries));
' "$PM2_NAME" "$PM_CWD_NATIVE" "$FAKE_EXPECTED_SHA" "$FAKE_MANIFEST_SHA" "$PM_EXEC_PATH_NATIVE" "$REAL_NODE_NATIVE" "$PM2_INSTANCE_MODE"
`,
  );

  const verifyPath = join(process.cwd(), "scripts/verify-release.sh");
  const invoke = (healthSha, pm2Mode = "healthy") =>
    run(bash, {
      args: [
        "-lc",
        `set -euo pipefail
native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
export CURRENT_LINK="$(native_to_unix "$CURRENT_NATIVE")"
export RELEASE_ROOT="$(native_to_unix "$RELEASE_NATIVE")"
export REAL_NODE="$(native_to_unix "$REAL_NODE_NATIVE")"
export PATH="$(native_to_unix "$BIN_NATIVE"):$PATH"
verify_script="$(native_to_unix "$VERIFY_NATIVE")"
bash "$verify_script" "$FAKE_EXPECTED_SHA" "$FAKE_MANIFEST_SHA"`,
      ],
      env: {
        ...process.env,
        CURRENT_NATIVE: currentLink,
        RELEASE_NATIVE: releaseRoot,
        BIN_NATIVE: fakeBin,
        VERIFY_NATIVE: verifyPath,
        REAL_NODE_NATIVE: process.execPath,
        PM2_NAME: "jingying-cabin-contract",
        PM_CWD_NATIVE: currentTarget,
        PM_EXEC_PATH_NATIVE: standaloneServer,
        FAKE_EXPECTED_SHA: expectedSha,
        FAKE_MANIFEST_SHA: expectedManifest,
        FAKE_HEALTH_SHA: healthSha,
        PM2_INSTANCE_MODE: pm2Mode,
      },
    });

  const healthy = invoke(expectedSha);
  assert.equal(healthy.status, 0, `${healthy.stdout}\n${healthy.stderr}`);
  const staleHealth = invoke("d".repeat(40));
  assert.notEqual(staleHealth.status, 0, "stale health SHA must be rejected");
  assert.match(staleHealth.stderr, /release\.sha does not match/);

  const staleInstance = invoke(expectedSha, "stale-instance");
  assert.notEqual(
    staleInstance.status,
    0,
    "every same-name PM2 instance must match",
  );
  assert.match(staleInstance.stderr, /one or more PM2 instances/);

  const extraArgs = invoke(expectedSha, "args");
  assert.notEqual(extraArgs.status, 0, "PM2 args must be exactly start");
  assert.match(extraArgs.stderr, /one or more PM2 instances/);
});

test("release cleanup counts protected releases inside KEEP_RELEASES", () => {
  const increment = position(deploy, "seen=$((seen + 1))");
  const protectedRelease = position(
    deploy,
    '[[ "$path" == "$current" || "$path" == "$previous_target" ]]',
  );
  const retention = position(deploy, '[[ "$seen" -le "$KEEP_RELEASES" ]]');
  assert.ok(increment < protectedRelease);
  assert.ok(protectedRelease < retention);
});

test("release cleanup preserves candidates when PM2 output is malformed", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-pm2-malformed-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const candidate = join(sandbox, "d".repeat(40));
  await mkdir(candidate);
  const deployPath = join(process.cwd(), "scripts/deploy.sh");

  const shell = run(bash, {
    args: [
      "-lc",
      `native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
source "$(native_to_unix "$DEPLOY_NATIVE")"
node() { "$(native_to_unix "$NODE_NATIVE")" "$@"; }
candidate="$(native_to_unix "$CANDIDATE_NATIVE")"
pm2_bounded() { printf '{malformed'; }
pm2_references_release "$candidate"
pm2_bounded() { printf '[null]'; }
pm2_references_release "$candidate"
pm2_bounded() { printf '[{"name":"other","pm2_env":null}]'; }
pm2_references_release "$candidate"
pm2_bounded() { printf '[]'; }
if pm2_references_release "$candidate"; then exit 55; fi`,
    ],
    env: {
      ...process.env,
      DEPLOY_NATIVE: deployPath,
      NODE_NATIVE: process.execPath,
      CANDIDATE_NATIVE: candidate,
    },
  });
  assert.equal(shell.status, 0, `${shell.stdout}\n${shell.stderr}`);
});

test("PostgREST proof requires a newer successful schema-cache generation", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-postgrest-generation-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const counter = join(sandbox, "counter");
  await writeFile(counter, "0\n");
  const deployPath = join(process.cwd(), "scripts/deploy.sh");

  const shell = run(bash, {
    args: [
      "-lc",
      `native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
source "$(native_to_unix "$DEPLOY_NATIVE")"
node() { "$(native_to_unix "$NODE_NATIVE")" "$@"; }
counter="$(native_to_unix "$COUNTER_NATIVE")"
POSTGREST_READY_URL=https://example.invalid/ready
POSTGREST_METRICS_URL=https://example.invalid/metrics
POSTGREST_SCHEMA_CACHE_URL=https://example.invalid/schema_cache
if validate_postgrest_admin_urls; then exit 56; fi
POSTGREST_READY_URL=http://127.0.0.1:3001/ready
POSTGREST_METRICS_URL=http://127.0.0.1:3001/metrics
POSTGREST_SCHEMA_CACHE_URL=http://127.0.0.1:3001/schema_cache
validate_postgrest_admin_urls
timeout() {
  printf '# HELP ignored\\npgrst_schema_cache_loads_total{status="FAIL"} 9\\npgrst_schema_cache_loads_total{status="SUCCESS"} 41\\n'
}
[[ "$(read_postgrest_schema_cache_generation)" == "41" ]]
timeout() { return 0; }
read_postgrest_schema_cache_generation() {
  value="$(cat "$counter")"
  value=$((value + 1))
  printf '%s\\n' "$value" > "$counter"
  if [[ "$value" -eq 1 ]]; then printf '41'; else printf '42'; fi
}
sleep() { :; }
postgrest_schema_cache_contains_probe() {
  [[ "$1" == "deploy_schema_probe_${"f".repeat(40)}" ]]
}
wait_for_postgrest_schema_cache 41 "deploy_schema_probe_${"f".repeat(40)}"
[[ "$(cat "$counter")" == "2" ]]`,
    ],
    env: {
      ...process.env,
      DEPLOY_NATIVE: deployPath,
      NODE_NATIVE: process.execPath,
      COUNTER_NATIVE: counter,
    },
  });
  assert.equal(shell.status, 0, `${shell.stdout}\n${shell.stderr}`);
});

test("package exposes the deploy contract", () => {
  assert.equal(
    packageJson.scripts["test:deploy-contract"],
    "node --test scripts/deploy-contract.test.mjs",
  );
});

test("hardening contracts fail closed across lock, env, ledger, rollback, and cleanup", () => {
  const main = deploy.slice(position(deploy, "main() {"));
  const lock = position(main, "acquire_deploy_lock");
  const firstGit = position(main, "validate_source_repo");
  assert.ok(lock < firstGit, "host lock must precede every git operation");
  assert.match(deploy, /ENV_FILE/);
  assert.match(deploy, /validate_secure_env_file/);
  assert.match(deploy, /validate_rollback_runtime/);
  assert.match(deploy, /validate_rollback_control_paths/);
  assert.match(deploy, /TRUSTED_CURRENT_SHA/);
  assert.match(deploy, /TRUSTED_CURRENT_MANIFEST_SHA256/);
  assert.match(deploy, /external release record/);
  assert.match(deploy, /supabase_migrations\.schema_migrations/);
  assert.match(deploy, /__atomic_release_bootstrap_v1__/);
  assert.match(deploy, /pg_advisory_xact_lock/);
  assert.match(deploy, /write_migration_manifest/);
  assert.match(deploy, /if ! find/);
  assert.match(deploy, /pm2_bounded save/);
  assert.doesNotMatch(deploy, /rm -rf/);
  assert.match(deploy, /POSTGREST_READY_URL/);
  assert.match(deploy, /POSTGREST_METRICS_URL/);
  assert.match(deploy, /POSTGREST_SCHEMA_CACHE_URL/);
  assert.match(
    deploy,
    /readonly LOCK_FILE="\/var\/lock\/jingying-cabin\/deploy\.lock"/,
  );
  assert.match(deploy, /--kill-after=5s/);
  assert.match(deploy, /read -r -t "\$read_timeout"/);
  assert.match(deploy, /DB_LOCK_TIMEOUT_MILLISECONDS/);
  assert.match(deploy, /DB_STATEMENT_TIMEOUT_MILLISECONDS/);
  assert.match(deploy, /set local lock_timeout/);
  assert.match(deploy, /set local statement_timeout/);
  assert.match(migrationValidator, /-- deploy: expand/);
  assert.match(migrationValidator, /psql meta-command is forbidden/);
  assert.match(migrationValidator, /top-level transaction control/);

  for (const option of [
    "--connect-timeout",
    "--max-time",
    "--retry-max-time",
  ]) {
    assert.ok(verify.includes(option), `verifier must include ${option}`);
  }
  assert.match(verify, /filter\(.*name/s);
  assert.match(verify, /every\(/);
  assert.match(verify, /normalizedArgs/);
  assert.match(ecosystem, /\.\.\.process\.env/);
  assert.match(ciWorkflow, /RELEASE_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(ciWorkflow, /prepare-standalone-release\.mjs/);
  assert.match(ciWorkflow, /release-integrity\.mjs write/);
  assert.match(ciWorkflow, /Release Git SHA/);
  assert.match(ciWorkflow, /tar --format=ustar/);
  assert.match(ciWorkflow, /sha256sum "\$artifact"/);
  assert.match(ciWorkflow, /actions\/upload-artifact@[0-9a-f]{40}\s+# v4/);
  assert.match(ciWorkflow, /release-runtime-\$\{\{ github\.sha \}\}/);
  assert.match(ciWorkflow, /GITHUB_STEP_SUMMARY/);
  assert.match(
    ciWorkflow,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/codex\/full-project-ui'/,
  );
  assert.match(ciWorkflow, /Verify reviewed release artifact round trip/);
  assert.match(ciWorkflow, /git worktree add --detach/);
  assert.match(ciWorkflow, /release-integrity\.mjs" verify/);
  assert.match(ciWorkflow, /127\.0\.0\.1:3999\/api\/health/);
  assert.match(artifactExtractor, /release artifact does not match/);
  assert.match(artifactExtractor, /createReadStream/);
  assert.doesNotMatch(artifactExtractor, /readFileSync\(archivePath\)/);
  assert.match(artifactExtractor, /POSIX ustar/);
  assert.match(artifactExtractor, /unsafe release artifact path/);
  assert.match(artifactExtractor, /entry type is not allowed/);
  assert.match(
    artifactExtractor,
    /entry\.path === "\.next\/standalone\/\.release-sha"[\s\S]*0o600/,
  );
  assert.match(
    standalonePreparer,
    /isInside\(standalone, target\)[\s\S]*isInside\(pnpmVirtualStore, target\)[\s\S]*escaped its generated roots/,
  );

  assert.doesNotMatch(legacyRollback, /git reset --hard/);
  assert.match(legacyRollback, /CURRENT_LINK/);
  assert.match(legacyRollback, /verify_release/);
  assert.match(legacyRollback, /validate_rollback_runtime/);
  assert.match(legacyRollback, /validate_rollback_control_paths/);
  assert.doesNotMatch(legacyRollback, /validate_source_repo/);
  assert.doesNotMatch(hermesRunbook, /APP_DIR=/);
  assert.match(hermesRunbook, /atomic-release-bootstrap/);
  assert.match(hermesRunbook, /subsequent releases/i);
  assert.match(hermesRunbook, /scripts\/deploy\.sh/);
  assert.match(bootstrapRunbook, /must not contain any migration/i);
  assert.match(bootstrapRunbook, /later, different `TARGET_SHA`/);
  assert.match(bootstrapRunbook, /DB_CONTAINER=/);
  assert.match(bootstrapRunbook, /LEGACY_RESTORE_SCRIPT/);
  assert.match(bootstrapRunbook, /restore command/i);
  assert.match(bootstrapRunbook, /STAGING_LINK/);
  assert.match(bootstrapRunbook, /STAGING_PM2_NAME/);
  assert.match(bootstrapRunbook, /PENDING_MIGRATIONS/);
  assert.match(bootstrapRunbook, /must never call `apply_migrations`/);
  assert.match(bootstrapRunbook, /CI_RUN_ID/);
  assert.match(bootstrapRunbook, /conclusion !== "success"/);
  assert.match(bootstrapRunbook, /run\.event !== "push"/);
  assert.match(bootstrapRunbook, /run\.headBranch !==/);
  assert.match(bootstrapRunbook, /EXPECTED_RELEASE_ARTIFACT_SHA256/);
  assert.match(bootstrapRunbook, /RELEASE_ARTIFACT_PATH/);
  assert.match(bootstrapRunbook, /extract-release-artifact\.mjs/);
  assert.match(
    bootstrapRunbook,
    /\/etc\/jingying-cabin\/release-controls\/release-integrity\.mjs/,
  );
  assert.match(
    bootstrapRunbook,
    /\/etc\/jingying-cabin\/release-controls\/verify-xingyao-hermes-rollback-package\.mjs/,
  );
  assert.match(bootstrapRunbook, /pm2 save/);
  assert.match(bootstrapRunbook, /legacy-pm2-before-bootstrap\.redacted\.json/);
  assert.match(bootstrapRunbook, /Never store raw `pm2 jlist`/);
  assert.match(hermesRunbook, /EXPECTED_RELEASE_ARTIFACT_SHA256/);
  assert.match(hermesRunbook, /RELEASE_ARTIFACT_PATH/);
  assert.match(hermesRunbook, /TRUSTED_RELEASE_INTEGRITY/);
  assert.match(hermesRunbook, /TRUSTED_ROLLBACK_PACKAGE_VERIFIER/);
  assert.doesNotMatch(
    hermesRunbook,
    /node "\$CURRENT_LINK\/scripts\/verify-xingyao-hermes-rollback-package\.mjs"/,
  );
  assert.doesNotMatch(
    `${bootstrapRunbook}\n${hermesRunbook}`,
    /timeout --signal=TERM 30s pm2/,
  );

  const mainActivation = main.slice(position(main, "atomic_switch_current"));
  const reload = position(mainActivation, 'reload_pm2 "$TARGET_SHA"');
  const exactVerify = position(mainActivation, 'verify_release "$TARGET_SHA"');
  const persist = position(mainActivation, "save_pm2");
  const rollback = position(
    mainActivation,
    "rollback_after_activation_failure",
  );
  assert.ok(
    reload < exactVerify && exactVerify < persist && persist < rollback,
  );
});
