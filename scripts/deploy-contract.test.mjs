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
import { spawnSync } from "node:child_process";

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
    ? rawTest(name, portableHandler, 30_000)
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

function run(command, options = {}) {
  return spawnSync(command, options.args ?? [], {
    encoding: "utf8",
    ...options,
  });
}

async function writeExecutable(path, contents) {
  await writeFile(path, contents, { mode: 0o755 });
}

test("builds the immutable candidate before touching migrations or current", () => {
  const main = deploy.slice(position(deploy, "main() {"));
  const build = position(main, 'RELEASE_SHA="$TARGET_SHA" pnpm run build');
  const migrate = position(main, "apply_migrations");
  const switchCurrent = position(
    main,
    'log "Atomically switching current release',
  );

  assert.ok(build < migrate, "candidate build must precede migrations");
  assert.ok(migrate < switchCurrent, "migrations must precede symlink switch");
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
  const reload = position(activation, "pm2 startOrReload");
  const verification = position(activation, "verify-release.sh");
  assert.ok(reload < verification, "verification must follow PM2 reload");

  assert.match(ecosystem, /cwd:\s*process\.env\.CURRENT_LINK/);
  assert.match(ecosystem, /script:\s*["']pnpm["']/);
  assert.match(ecosystem, /args:\s*["']start["']/);
  assert.match(ecosystem, /RELEASE_SHA:\s*process\.env\.RELEASE_SHA/);
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

test("candidate build failure leaves database, PM2, and current release untouched", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "deploy-build-failure-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const sourceRepo = join(sandbox, "source");
  const releaseRoot = join(sandbox, "releases");
  const fakeBin = join(sandbox, "bin");
  const callsFile = join(sandbox, "calls.log");
  const envFile = join(sandbox, "production.env");
  const previousSha = "a".repeat(40);
  const targetSha = "b".repeat(40);
  const previousTarget = join(releaseRoot, previousSha);
  const currentLink = join(sandbox, "current");
  await mkdir(join(sourceRepo, ".git"), { recursive: true });
  await mkdir(previousTarget, { recursive: true });
  await mkdir(fakeBin);
  await writeFile(callsFile, "");
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
    join(previousTarget, "app/api/health/route.ts"),
    "const sha = process.env.RELEASE_SHA;\n",
  );
  await symlink(
    previousTarget,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );

  await writeExecutable(
    join(fakeBin, "git"),
    `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> "$CALLS_FILE"
if [[ "$1" == "-C" ]]; then REPO="$2"; shift 2; fi
case "$1 $2" in
  "rev-parse --show-toplevel") printf '%s\\n' "$REPO" ;;
  "rev-parse origin/"*) printf '%s\\n' "$FAKE_TARGET_SHA" ;;
  "worktree add") mkdir -p -- "$4" ;;
  "worktree remove") exit 1 ;;
  *) exit 0 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "node"),
    `#!/usr/bin/env bash
if [[ "$1" == "-p" ]]; then printf '20\\n'; else printf 'v20.20.2\\n'; fi
`,
  );
  await writeExecutable(
    join(fakeBin, "pnpm"),
    `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then printf '10.12.1\\n'; exit 0; fi
printf 'pnpm %s\\n' "$*" >> "$CALLS_FILE"
if [[ "$1 $2" == "run build" ]]; then exit 17; fi
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
  for (const command of ["corepack", "docker", "pm2", "curl", "flock"]) {
    await writeExecutable(
      join(fakeBin, command),
      `#!/usr/bin/env bash
printf '${command} %s\\n' "$*" >> "$CALLS_FILE"
`,
    );
  }

  const deployPath = join(process.cwd(), "scripts/deploy.sh");
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
        DEPLOY_NATIVE: deployPath,
        ...extraEnv,
      },
    });

  const missingEnv = invoke();
  assert.notEqual(missingEnv.status, 0);
  assert.match(missingEnv.stderr, /ENV_FILE is missing/);
  assert.equal(await readFile(callsFile, "utf8"), "");

  await writeFile(
    envFile,
    "POSTGREST_READY_URL=http://127.0.0.1:3001/ready\n",
    {
      mode: 0o640,
    },
  );
  const unsafeEnv = invoke({ FAKE_INSECURE_ENV: "1" });
  assert.notEqual(unsafeEnv.status, 0);
  assert.match(unsafeEnv.stderr, /group\/world writable/);
  assert.equal(await readFile(callsFile, "utf8"), "");

  const shell = invoke();
  assert.notEqual(shell.status, 0, "the simulated candidate build must fail");

  const calls = await readFile(callsFile, "utf8");
  assert.match(calls, /pnpm install --frozen-lockfile/);
  assert.match(calls, /pnpm run build/);
  assert.doesNotMatch(calls, /^docker /m);
  assert.doesNotMatch(calls, /^pm2 /m);
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
export RELEASE_ROOT="$(native_to_unix "$RELEASE_NATIVE")"
export FAKE_FLOCK_STATE="$(native_to_unix "$LOCK_STATE_NATIVE")"
source "$(native_to_unix "$DEPLOY_NATIVE")"
acquire_deploy_lock`;
  const env = {
    ...process.env,
    BIN_NATIVE: fakeBin,
    RELEASE_NATIVE: releaseRoot,
    LOCK_STATE_NATIVE: lockState,
    DEPLOY_NATIVE: deployPath,
  };
  const first = run(bash, { args: ["-lc", shellScript], env });
  assert.equal(first.status, 0, first.stderr);

  const second = run(bash, { args: ["-lc", shellScript], env });
  assert.notEqual(second.status, 0, "concurrent deployment must fail");
  assert.match(second.stderr, /another deployment already holds/);
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
  await mkdir(currentTarget, { recursive: true });
  await mkdir(fakeBin);
  await symlink(
    currentTarget,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );

  await writeExecutable(
    join(fakeBin, "curl"),
    `#!/usr/bin/env bash
printf '{"ok":true,"release":{"sha":"%s"}}\\n' "$FAKE_HEALTH_SHA"
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
  const [name,cwd,sha,mode]=process.argv.slice(1);
  const entry={name,pm2_env:{status:"online",RELEASE_SHA:sha,pm_cwd:cwd,pm_exec_path:"/usr/local/bin/pnpm",args:["start"]}};
  if (mode === "args") entry.pm2_env.args=["start", "--bad"];
  const entries=[entry];
  if (mode === "stale-instance") entries.push({name,pm2_env:{...entry.pm2_env,RELEASE_SHA:"d".repeat(40)}});
  console.log(JSON.stringify(entries));
' "$PM2_NAME" "$PM_CWD_NATIVE" "$FAKE_EXPECTED_SHA" "$PM2_INSTANCE_MODE"
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
bash "$verify_script" "$FAKE_EXPECTED_SHA"`,
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
        FAKE_EXPECTED_SHA: expectedSha,
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
  assert.match(deploy, /supabase_migrations\.schema_migrations/);
  assert.match(deploy, /__atomic_release_bootstrap_v1__/);
  assert.match(deploy, /pg_advisory_xact_lock/);
  assert.match(deploy, /write_migration_manifest/);
  assert.match(deploy, /if ! find/);
  assert.match(deploy, /pm2 save/);
  assert.doesNotMatch(deploy, /rm -rf/);
  assert.match(deploy, /POSTGREST_READY_URL/);
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
  assert.match(bootstrapRunbook, /pm2 save/);
  assert.match(bootstrapRunbook, /legacy-pm2-before-bootstrap\.redacted\.json/);
  assert.match(bootstrapRunbook, /Never store raw `pm2 jlist`/);

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
