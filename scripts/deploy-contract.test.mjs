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
  return rawTest(name, async (context = {}) => {
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
  });
}

const [deploy, verify, ecosystem, packageJson] = await Promise.all([
  readFile(join(process.cwd(), "scripts/deploy.sh"), "utf8"),
  readFile(join(process.cwd(), "scripts/verify-release.sh"), "utf8"),
  readFile(join(process.cwd(), "ecosystem.config.cjs"), "utf8"),
  readFile(join(process.cwd(), "package.json"), "utf8").then(JSON.parse),
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
  const build = position(deploy, 'RELEASE_SHA="$TARGET_SHA" pnpm run build');
  const migrate = position(
    deploy,
    'apply_migrations "$release_dir/supabase/migrations"',
  );
  const switchCurrent = position(
    deploy,
    'log "Atomically switching current release',
  );

  assert.ok(build < migrate, "candidate build must precede migrations");
  assert.ok(migrate < switchCurrent, "migrations must precede symlink switch");
  assert.match(deploy, /db --single-transaction/);
  assert.match(deploy, /-- deploy: expand/);
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
  const reload = position(deploy, "pm2 startOrReload");
  const verification = position(deploy, "verify-release.sh");
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
expected_link="$(normalize_path "$CURRENT_LINK")"
validate_paths
load_previous_release
[[ "$CURRENT_LINK" == "$expected_link" ]]
[[ "$previous_target" == "$RELEASE_ROOT/${targetSha}" ]]
[[ "$previous_sha" == "${targetSha}" ]]
release_dir="$RELEASE_ROOT/${candidateSha}"
case "$(uname -s)" in
  MINGW*) ;; # Git Bash emulates directory links and cannot exercise mv -T.
  *)
    atomic_switch_current
    [[ "$(normalize_path "$(readlink -f "$CURRENT_LINK")")" == "$release_dir" ]]
    rollback_current
    [[ "$(normalize_path "$(readlink -f "$CURRENT_LINK")")" == "$previous_target" ]]
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
  const previousSha = "a".repeat(40);
  const targetSha = "b".repeat(40);
  const previousTarget = join(releaseRoot, previousSha);
  const currentLink = join(sandbox, "current");
  await mkdir(join(sourceRepo, ".git"), { recursive: true });
  await mkdir(previousTarget, { recursive: true });
  await mkdir(fakeBin);
  await symlink(
    previousTarget,
    currentLink,
    process.platform === "win32" ? "junction" : "dir",
  );

  await writeExecutable(
    join(fakeBin, "git"),
    `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> "$CALLS_FILE"
if [[ "$1" == "-C" ]]; then shift 2; fi
case "$1 $2" in
  "rev-parse --show-prefix") exit 0 ;;
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
  for (const command of ["corepack", "docker", "pm2", "curl"]) {
    await writeExecutable(
      join(fakeBin, command),
      `#!/usr/bin/env bash
printf '${command} %s\\n' "$*" >> "$CALLS_FILE"
`,
    );
  }

  const deployPath = join(process.cwd(), "scripts/deploy.sh");
  const shell = run(bash, {
    args: [
      "-lc",
      `set -uo pipefail
native_to_unix() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
export SOURCE_REPO="$(native_to_unix "$SOURCE_NATIVE")"
export RELEASE_ROOT="$(native_to_unix "$RELEASE_NATIVE")"
export CURRENT_LINK="$(native_to_unix "$CURRENT_NATIVE")"
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
      CALLS_NATIVE: callsFile,
      BIN_NATIVE: fakeBin,
      DEPLOY_NATIVE: deployPath,
    },
  });
  assert.notEqual(shell.status, 0, "the simulated candidate build must fail");

  const calls = await readFile(callsFile, "utf8");
  assert.match(calls, /pnpm install --frozen-lockfile/);
  assert.match(calls, /pnpm run build/);
  assert.doesNotMatch(calls, /^docker /m);
  assert.doesNotMatch(calls, /^pm2 /m);
  const linkedTarget = await readlink(currentLink);
  assert.equal(resolve(linkedTarget), resolve(previousTarget));
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
node -e 'const [name,cwd,sha]=process.argv.slice(1); console.log(JSON.stringify([{name,pm2_env:{status:"online",RELEASE_SHA:sha,pm_cwd:cwd,pm_exec_path:"/usr/local/bin/pnpm",args:["start"]}}]))' "$PM2_NAME" "$PM_CWD_NATIVE" "$FAKE_EXPECTED_SHA"
`,
  );

  const verifyPath = join(process.cwd(), "scripts/verify-release.sh");
  const invoke = (healthSha) =>
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
      },
    });

  const healthy = invoke(expectedSha);
  assert.equal(healthy.status, 0, `${healthy.stdout}\n${healthy.stderr}`);
  const staleHealth = invoke("d".repeat(40));
  assert.notEqual(staleHealth.status, 0, "stale health SHA must be rejected");
  assert.match(staleHealth.stderr, /release\.sha does not match/);
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
