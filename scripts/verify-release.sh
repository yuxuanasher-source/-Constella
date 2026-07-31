#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:-}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/jingying-cabin-current}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/cache/jingying-cabin-releases}"
PM2_NAME="${PM2_NAME:-jingying-cabin}"
PM2_TIMEOUT_SECONDS="${PM2_TIMEOUT_SECONDS:-30}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

die() { printf '[verify-release] %s\n' "$*" >&2; exit 1; }

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  die "expected SHA must be the full 40-character lowercase Git SHA"
[[ "$CURRENT_LINK" == /* ]] || die "CURRENT_LINK must be absolute"
[[ "$RELEASE_ROOT" == /* ]] || die "RELEASE_ROOT must be absolute"
[[ "$PM2_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
  die "PM2_TIMEOUT_SECONDS must be a positive integer"
[[ -L "$CURRENT_LINK" ]] || die "CURRENT_LINK is not a symlink: $CURRENT_LINK"

current_target="$(readlink -f "$CURRENT_LINK")"
[[ -d "$current_target" ]] || die "current release target does not exist"
[[ "$(dirname "$current_target")" == "$(realpath -ms -- "$RELEASE_ROOT")" ]] ||
  die "current release target is outside RELEASE_ROOT"
[[ "$(basename "$current_target")" == "$EXPECTED_SHA" ]] ||
  die "current symlink does not target expected SHA"
node "$current_target/scripts/release-integrity.mjs" verify "$current_target" "$EXPECTED_SHA"

health_file="$(mktemp)"
pm2_file="$(mktemp)"
trap 'rm -f -- "$health_file" "$pm2_file"' EXIT

timeout --signal=TERM 30s curl --fail --silent --show-error \
  --connect-timeout 2 --max-time 5 --retry 5 --retry-delay 1 \
  --retry-all-errors --retry-max-time 25 "$HEALTH_URL" > "$health_file"

node - "$health_file" "$EXPECTED_SHA" <<'NODE'
const fs = require("node:fs");
const [file, expected] = process.argv.slice(2);
const body = JSON.parse(fs.readFileSync(file, "utf8"));
if (body.ok !== true) throw new Error("health response is not ok");
if (body.release?.sha !== expected) {
  throw new Error("health response release.sha does not match the full expected SHA");
}
NODE

timeout --signal=TERM "${PM2_TIMEOUT_SECONDS}s" pm2 jlist > "$pm2_file"
node - "$pm2_file" "$PM2_NAME" "$CURRENT_LINK" "$current_target" "$EXPECTED_SHA" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [file, name, currentLink, expectedTarget, expectedSha] = process.argv.slice(2);
const processes = JSON.parse(fs.readFileSync(file, "utf8"));
const matchingProcesses = processes.filter((entry) => entry?.name === name);
if (matchingProcesses.length === 0) throw new Error(`PM2 process not found: ${name}`);
if (fs.realpathSync(currentLink) !== fs.realpathSync(expectedTarget)) {
  throw new Error("CURRENT_LINK changed during verification");
}

const valid = matchingProcesses.every((processEntry) => {
  const env = processEntry.pm2_env ?? {};
  const pm_cwd = env.pm_cwd;
  const pm_exec_path = env.pm_exec_path;
  const normalizedArgs = Array.isArray(env.args)
    ? env.args.map(String)
    : typeof env.args === "string"
      ? [env.args.trim()]
      : [];
  return (
    env.status === "online" &&
    env.RELEASE_SHA === expectedSha &&
    typeof pm_cwd === "string" &&
    typeof pm_exec_path === "string" &&
    fs.realpathSync(pm_cwd) === fs.realpathSync(expectedTarget) &&
    /^pnpm(?:\.cjs)?$/.test(path.basename(pm_exec_path)) &&
    normalizedArgs.length === 1 &&
    normalizedArgs[0] === "start"
  );
});
if (!valid) {
  throw new Error("one or more PM2 instances failed exact release verification");
}
NODE

printf '[verify-release] verified %s\n' "$EXPECTED_SHA"
