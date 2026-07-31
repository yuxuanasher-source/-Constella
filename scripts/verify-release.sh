#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:-}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/jingying-cabin-current}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/cache/jingying-cabin-releases}"
PM2_NAME="${PM2_NAME:-jingying-cabin}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

die() { printf '[verify-release] %s\n' "$*" >&2; exit 1; }

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  die "expected SHA must be the full 40-character lowercase Git SHA"
[[ "$CURRENT_LINK" == /* ]] || die "CURRENT_LINK must be absolute"
[[ "$RELEASE_ROOT" == /* ]] || die "RELEASE_ROOT must be absolute"
[[ -L "$CURRENT_LINK" ]] || die "CURRENT_LINK is not a symlink: $CURRENT_LINK"

current_target="$(readlink -f "$CURRENT_LINK")"
[[ -d "$current_target" ]] || die "current release target does not exist"
[[ "$(dirname "$current_target")" == "$(realpath -ms -- "$RELEASE_ROOT")" ]] ||
  die "current release target is outside RELEASE_ROOT"
[[ "$(basename "$current_target")" == "$EXPECTED_SHA" ]] ||
  die "current symlink does not target expected SHA"

health_file="$(mktemp)"
pm2_file="$(mktemp)"
trap 'rm -f -- "$health_file" "$pm2_file"' EXIT

curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors \
  "$HEALTH_URL" > "$health_file"

node - "$health_file" "$EXPECTED_SHA" <<'NODE'
const fs = require("node:fs");
const [file, expected] = process.argv.slice(2);
const body = JSON.parse(fs.readFileSync(file, "utf8"));
if (body.ok !== true) throw new Error("health response is not ok");
if (body.release?.sha !== expected) {
  throw new Error("health response release.sha does not match the full expected SHA");
}
NODE

pm2 jlist > "$pm2_file"
node - "$pm2_file" "$PM2_NAME" "$CURRENT_LINK" "$current_target" "$EXPECTED_SHA" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [file, name, currentLink, expectedTarget, expectedSha] = process.argv.slice(2);
const processes = JSON.parse(fs.readFileSync(file, "utf8"));
const processEntry = processes.find((entry) => entry?.name === name);
if (!processEntry) throw new Error(`PM2 process not found: ${name}`);
const env = processEntry.pm2_env ?? {};
if (env.status !== "online") throw new Error(`PM2 process is not online: ${env.status}`);
if (env.RELEASE_SHA !== expectedSha) throw new Error("PM2 RELEASE_SHA does not match");

const pm_cwd = env.pm_cwd;
const pm_exec_path = env.pm_exec_path;
if (typeof pm_cwd !== "string") throw new Error("PM2 cwd is missing");
if (typeof pm_exec_path !== "string") throw new Error("PM2 script is missing");
if (fs.realpathSync(pm_cwd) !== fs.realpathSync(expectedTarget)) {
  throw new Error(`PM2 cwd is not current release: ${pm_cwd}`);
}
if (fs.realpathSync(currentLink) !== fs.realpathSync(expectedTarget)) {
  throw new Error("CURRENT_LINK changed during verification");
}
if (!/^pnpm(?:\.cjs)?$/.test(path.basename(pm_exec_path))) {
  throw new Error(`PM2 script is not pnpm: ${pm_exec_path}`);
}
if (!String(env.args ?? "").includes("start")) {
  throw new Error("PM2 arguments do not start the application");
}
NODE

printf '[verify-release] verified %s\n' "$EXPECTED_SHA"
