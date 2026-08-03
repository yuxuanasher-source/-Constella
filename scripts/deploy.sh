#!/usr/bin/env bash
# Atomic production deployment:
#   secure env + host lock -> exact reviewed CI artifact -> read-only migration
#   preflight -> serialized expand migrations -> committed bounded backfills ->
#   atomic symlink switch -> exact release verification -> persistent PM2 state.
set -Eeuo pipefail
umask 077
export LC_ALL=C

SOURCE_REPO="${SOURCE_REPO:-/var/www/jingying-cabin}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/cache/jingying-cabin-releases}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/jingying-cabin-current}"
ENV_FILE="${ENV_FILE:-/etc/jingying-cabin/production.env}"
readonly LOCK_FILE="/var/lock/jingying-cabin/deploy.lock"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
BRANCH="${BRANCH:-codex/full-project-ui}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
EXPECTED_RELEASE_MANIFEST_SHA256="${EXPECTED_RELEASE_MANIFEST_SHA256:-}"
RELEASE_ARTIFACT_PATH="${RELEASE_ARTIFACT_PATH:-}"
EXPECTED_RELEASE_ARTIFACT_SHA256="${EXPECTED_RELEASE_ARTIFACT_SHA256:-}"
TRUSTED_CURRENT_SHA="${TRUSTED_CURRENT_SHA:-}"
TRUSTED_CURRENT_MANIFEST_SHA256="${TRUSTED_CURRENT_MANIFEST_SHA256:-}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_NAME="${DB_NAME:-postgres}"
PM2_NAME="${PM2_NAME:-jingying-cabin}"
PM2_TIMEOUT_SECONDS="${PM2_TIMEOUT_SECONDS:-30}"
DATABASE_LEASE_WAIT_SECONDS="${DATABASE_LEASE_WAIT_SECONDS:-60}"
DB_COMMAND_TIMEOUT_SECONDS="${DB_COMMAND_TIMEOUT_SECONDS:-300}"
DB_RESPONSE_TIMEOUT_SECONDS="${DB_RESPONSE_TIMEOUT_SECONDS:-10}"
DB_LOCK_TIMEOUT_MILLISECONDS="${DB_LOCK_TIMEOUT_MILLISECONDS:-15000}"
DB_STATEMENT_TIMEOUT_MILLISECONDS="${DB_STATEMENT_TIMEOUT_MILLISECONDS:-300000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
POSTGREST_READY_URL="${POSTGREST_READY_URL:-}"
POSTGREST_METRICS_URL="${POSTGREST_METRICS_URL:-}"
POSTGREST_SCHEMA_CACHE_URL="${POSTGREST_SCHEMA_CACHE_URL:-}"

BOOTSTRAP_SENTINEL="__atomic_release_bootstrap_v1__"
BOOTSTRAP_VERSION="bootstrap-v1"
BOOTSTRAP_CONTENT_SHA256="0000000000000000000000000000000000000000000000000000000000000000"
MIGRATION_LOCK_KEY="jingying-cabin:deploy-migrations:v1"
MIGRATION_LEASE_KEY="jingying-cabin:deploy-lease:v2"
readonly AI_TURN_TELEMETRY_BACKFILL_VERSION="20260803120500"
readonly AI_TURN_TELEMETRY_BACKFILL_BATCH_SIZE=500
readonly AI_TURN_TELEMETRY_BACKFILL_TASK="ai_turn_stage_telemetry_accepted_at_v1"

TARGET_SHA=""
release_dir=""
previous_target=""
previous_sha=""
previous_manifest_sha=""
migration_manifest=""
release_cleanup_manifest=""
candidate_cleanup_intended=0
candidate_pm2_may_be_active=0
candidate_activation_attempted=0
current_switched=0
custom_ledger_state=""
declare -a PENDING_MIGRATIONS=()
declare -a BOOTSTRAP_FILENAMES=()
declare -A MIGRATION_VERSIONS=()
declare -A MIGRATION_HASHES=()
declare -A SUPABASE_LEDGER_VERSIONS=()
declare -A CUSTOM_LEDGER_FILES=()
declare -A CUSTOM_LEDGER_HASHES=()
declare -A PENDING_VERSIONS=()
LOCK_FD=""
DB_LEASE_INPUT_FD=""
DB_LEASE_OUTPUT_FD=""
DB_LEASE_PID=""
DB_LEASE_ACTIVE=0

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

require_absolute_path() {
  local name="$1" value="$2"
  [[ "$value" == /* ]] || die "$name must be an absolute path: $value"
}

lexical_path() {
  realpath -ms -- "$1"
}

physical_path() {
  realpath -e -- "$1"
}

reject_dangerous_path() {
  local name="$1" value="$2" normalized home_path
  normalized="$(lexical_path "$value")"
  home_path=""
  [[ -z "${HOME:-}" ]] || home_path="$(lexical_path "$HOME")"
  case "$normalized" in
    "/"|"/var"|"/var/cache")
      die "$name is a protected path: $normalized"
      ;;
  esac
  [[ -z "$home_path" || "$normalized" != "$home_path" ]] ||
    die "$name is a protected path: $normalized"
}

path_is_within() {
  local child="$1" parent="$2"
  [[ "$child" == "$parent"/* ]]
}

validate_owner_and_mode() {
  local name="$1" path="$2" expected_type="$3" owner mode current_uid
  current_uid="$(id -u)"
  owner="$(stat -Lc '%u' -- "$path")" || die "cannot stat owner for $name: $path"
  mode="$(stat -Lc '%a' -- "$path")" || die "cannot stat mode for $name: $path"
  [[ "$owner" == "0" || "$owner" == "$current_uid" ]] ||
    die "$name must be owned by root or uid $current_uid: $path"
  (( (8#$mode & 0022) == 0 )) ||
    die "$name must not be group/world writable (mode $mode): $path"
  case "$expected_type" in
    file) [[ -f "$path" && ! -L "$path" ]] || die "$name must be a regular non-symlink file: $path" ;;
    dir) [[ -d "$path" ]] || die "$name must be a directory: $path" ;;
    *) die "unknown secure path type: $expected_type" ;;
  esac
}

validate_secure_env_file() {
  local env_parent
  require_absolute_path "ENV_FILE" "$ENV_FILE"
  ENV_FILE="$(lexical_path "$ENV_FILE")"
  [[ -e "$ENV_FILE" ]] || die "ENV_FILE is missing: $ENV_FILE"
  env_parent="$(physical_path "$(dirname "$ENV_FILE")")"
  validate_owner_and_mode "ENV_FILE parent" "$env_parent" dir
  validate_owner_and_mode "ENV_FILE" "$ENV_FILE" file
  ENV_FILE="$(physical_path "$ENV_FILE")"
}

load_runtime_env() {
  local saved_source="$SOURCE_REPO" saved_root="$RELEASE_ROOT"
  local saved_current="$CURRENT_LINK" saved_env="$ENV_FILE"
  local saved_keep="$KEEP_RELEASES" saved_branch="$BRANCH"
  local saved_expected="$EXPECTED_SHA"
  local saved_expected_manifest="$EXPECTED_RELEASE_MANIFEST_SHA256"
  local saved_artifact="$RELEASE_ARTIFACT_PATH"
  local saved_artifact_sha="$EXPECTED_RELEASE_ARTIFACT_SHA256"
  local saved_current_sha="$TRUSTED_CURRENT_SHA"
  local saved_current_manifest="$TRUSTED_CURRENT_MANIFEST_SHA256"
  local saved_db="$DB_CONTAINER" saved_db_name="$DB_NAME" saved_pm2="$PM2_NAME"
  local saved_pm2_timeout="$PM2_TIMEOUT_SECONDS"
  local saved_database_lease_wait="$DATABASE_LEASE_WAIT_SECONDS"
  local saved_db_command_timeout="$DB_COMMAND_TIMEOUT_SECONDS"
  local saved_db_response_timeout="$DB_RESPONSE_TIMEOUT_SECONDS"
  local saved_db_lock_timeout="$DB_LOCK_TIMEOUT_MILLISECONDS"
  local saved_db_statement_timeout="$DB_STATEMENT_TIMEOUT_MILLISECONDS"

  set -a
  # shellcheck disable=SC1090 -- path was validated as a secure regular file.
  source "$ENV_FILE"
  set +a

  SOURCE_REPO="$saved_source"
  RELEASE_ROOT="$saved_root"
  CURRENT_LINK="$saved_current"
  ENV_FILE="$saved_env"
  KEEP_RELEASES="$saved_keep"
  BRANCH="$saved_branch"
  EXPECTED_SHA="$saved_expected"
  EXPECTED_RELEASE_MANIFEST_SHA256="$saved_expected_manifest"
  RELEASE_ARTIFACT_PATH="$saved_artifact"
  EXPECTED_RELEASE_ARTIFACT_SHA256="$saved_artifact_sha"
  TRUSTED_CURRENT_SHA="$saved_current_sha"
  TRUSTED_CURRENT_MANIFEST_SHA256="$saved_current_manifest"
  DB_CONTAINER="$saved_db"
  DB_NAME="$saved_db_name"
  PM2_NAME="$saved_pm2"
  PM2_TIMEOUT_SECONDS="$saved_pm2_timeout"
  DATABASE_LEASE_WAIT_SECONDS="$saved_database_lease_wait"
  DB_COMMAND_TIMEOUT_SECONDS="$saved_db_command_timeout"
  DB_RESPONSE_TIMEOUT_SECONDS="$saved_db_response_timeout"
  DB_LOCK_TIMEOUT_MILLISECONDS="$saved_db_lock_timeout"
  DB_STATEMENT_TIMEOUT_MILLISECONDS="$saved_db_statement_timeout"
  export ENV_FILE
  POSTGREST_READY_URL="${POSTGREST_READY_URL:-}"
  POSTGREST_METRICS_URL="${POSTGREST_METRICS_URL:-}"
  POSTGREST_SCHEMA_CACHE_URL="${POSTGREST_SCHEMA_CACHE_URL:-}"
  HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
}

validate_control_paths() {
  local current_parent current_name
  for entry in SOURCE_REPO RELEASE_ROOT CURRENT_LINK; do
    require_absolute_path "$entry" "${!entry}"
    reject_dangerous_path "$entry" "${!entry}"
  done

  [[ -d "$SOURCE_REPO" ]] || die "SOURCE_REPO does not exist: $SOURCE_REPO"
  [[ -d "$RELEASE_ROOT" ]] ||
    die "RELEASE_ROOT must be pre-created by the atomic bootstrap runbook: $RELEASE_ROOT"

  SOURCE_REPO="$(physical_path "$SOURCE_REPO")"
  RELEASE_ROOT="$(physical_path "$RELEASE_ROOT")"
  current_parent="$(physical_path "$(dirname "$(lexical_path "$CURRENT_LINK")")")"
  current_name="$(basename "$(lexical_path "$CURRENT_LINK")")"
  [[ "$current_name" != "." && "$current_name" != ".." && -n "$current_name" ]] ||
    die "CURRENT_LINK must retain a safe basename"
  CURRENT_LINK="$current_parent/$current_name"

  reject_dangerous_path "SOURCE_REPO" "$SOURCE_REPO"
  reject_dangerous_path "RELEASE_ROOT" "$RELEASE_ROOT"
  reject_dangerous_path "CURRENT_LINK" "$CURRENT_LINK"
  validate_owner_and_mode "SOURCE_REPO" "$SOURCE_REPO" dir
  validate_owner_and_mode "RELEASE_ROOT" "$RELEASE_ROOT" dir
  validate_owner_and_mode "CURRENT_LINK parent" "$current_parent" dir

  [[ "$RELEASE_ROOT" != "$SOURCE_REPO" ]] || die "RELEASE_ROOT must not equal SOURCE_REPO"
  ! path_is_within "$RELEASE_ROOT" "$SOURCE_REPO" || die "RELEASE_ROOT must not be inside SOURCE_REPO"
  ! path_is_within "$SOURCE_REPO" "$RELEASE_ROOT" || die "RELEASE_ROOT must not contain SOURCE_REPO"
  [[ "$CURRENT_LINK" != "$SOURCE_REPO" && "$CURRENT_LINK" != "$RELEASE_ROOT" ]] ||
    die "CURRENT_LINK must not equal a repository or release root"
  ! path_is_within "$CURRENT_LINK" "$RELEASE_ROOT" || die "CURRENT_LINK must be outside RELEASE_ROOT"
  [[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] || die "KEEP_RELEASES must be a positive integer"
}

validate_rollback_control_paths() {
  local current_parent current_name
  for entry in RELEASE_ROOT CURRENT_LINK; do
    require_absolute_path "$entry" "${!entry}"
    reject_dangerous_path "$entry" "${!entry}"
  done
  [[ -d "$RELEASE_ROOT" ]] || die "RELEASE_ROOT does not exist: $RELEASE_ROOT"

  RELEASE_ROOT="$(physical_path "$RELEASE_ROOT")"
  current_parent="$(physical_path "$(dirname "$(lexical_path "$CURRENT_LINK")")")"
  current_name="$(basename "$(lexical_path "$CURRENT_LINK")")"
  [[ "$current_name" != "." && "$current_name" != ".." && -n "$current_name" ]] ||
    die "CURRENT_LINK must retain a safe basename"
  CURRENT_LINK="$current_parent/$current_name"

  reject_dangerous_path "RELEASE_ROOT" "$RELEASE_ROOT"
  reject_dangerous_path "CURRENT_LINK" "$CURRENT_LINK"
  validate_owner_and_mode "RELEASE_ROOT" "$RELEASE_ROOT" dir
  validate_owner_and_mode "CURRENT_LINK parent" "$current_parent" dir
  [[ "$CURRENT_LINK" != "$RELEASE_ROOT" ]] ||
    die "CURRENT_LINK must not equal RELEASE_ROOT"
  ! path_is_within "$CURRENT_LINK" "$RELEASE_ROOT" ||
    die "CURRENT_LINK must be outside RELEASE_ROOT"
}

validate_rollback_runtime() {
  local node_major
  for command_name in realpath sha256sum stat id node pm2 curl timeout flock; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
  done
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$node_major" == "20" ]] || die "Node major must be 20 (found $(node --version))"
  [[ "$PM2_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    die "PM2_TIMEOUT_SECONDS must be a positive integer"
  [[ "$DATABASE_LEASE_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    die "DATABASE_LEASE_WAIT_SECONDS must be a positive integer"
  for timeout_name in \
    DB_COMMAND_TIMEOUT_SECONDS \
    DB_RESPONSE_TIMEOUT_SECONDS \
    DB_LOCK_TIMEOUT_MILLISECONDS \
    DB_STATEMENT_TIMEOUT_MILLISECONDS; do
    [[ "${!timeout_name}" =~ ^[1-9][0-9]*$ ]] ||
      die "$timeout_name must be a positive integer"
  done
}

validate_runtime() {
  validate_rollback_runtime
  for command_name in git docker find sort; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
  done
}

acquire_deploy_lock_at() {
  local requested_lock="$1"
  local lock_parent path_identity fd_identity
  require_absolute_path "LOCK_FILE" "$requested_lock"
  requested_lock="$(lexical_path "$requested_lock")"
  reject_dangerous_path "LOCK_FILE" "$requested_lock"
  lock_parent="$(physical_path "$(dirname "$requested_lock")")"
  validate_owner_and_mode "deploy lock parent" "$lock_parent" dir
  requested_lock="$lock_parent/$(basename "$requested_lock")"
  if [[ -e "$requested_lock" || -L "$requested_lock" ]]; then
    validate_owner_and_mode "deploy lock" "$requested_lock" file
  else
    ( umask 077; : > "$requested_lock" ) ||
      die "cannot create deploy lock: $requested_lock"
    validate_owner_and_mode "deploy lock" "$requested_lock" file
  fi
  exec {LOCK_FD}<>"$requested_lock" ||
    die "cannot open deploy lock: $requested_lock"
  path_identity="$(stat -Lc '%d:%i' -- "$requested_lock")"
  fd_identity="$(stat -Lc '%d:%i' -- "/proc/$$/fd/$LOCK_FD")" ||
    die "cannot verify physical deploy lock descriptor"
  [[ "$path_identity" == "$fd_identity" ]] || die "deploy lock path changed while opening"
  flock -n "$LOCK_FD" || die "another deployment already holds $requested_lock"
}

acquire_deploy_lock() {
  acquire_deploy_lock_at "$LOCK_FILE"
}

validate_source_repo() {
  local git_root
  [[ -d "$SOURCE_REPO/.git" || -f "$SOURCE_REPO/.git" ]] ||
    die "SOURCE_REPO is not a Git worktree: $SOURCE_REPO"
  git_root="$(git -C "$SOURCE_REPO" rev-parse --show-toplevel)"
  git_root="$(physical_path "$git_root")"
  [[ "$git_root" == "$SOURCE_REPO" ]] || die "SOURCE_REPO must be the physical repository root: $git_root"
}

validate_release_artifact() {
  local artifact_parent
  require_absolute_path "RELEASE_ARTIFACT_PATH" "$RELEASE_ARTIFACT_PATH"
  RELEASE_ARTIFACT_PATH="$(lexical_path "$RELEASE_ARTIFACT_PATH")"
  [[ -e "$RELEASE_ARTIFACT_PATH" ]] ||
    die "release artifact is missing: $RELEASE_ARTIFACT_PATH"
  artifact_parent="$(physical_path "$(dirname "$RELEASE_ARTIFACT_PATH")")"
  validate_owner_and_mode "release artifact parent" "$artifact_parent" dir
  validate_owner_and_mode "release artifact" "$RELEASE_ARTIFACT_PATH" file
  RELEASE_ARTIFACT_PATH="$(physical_path "$RELEASE_ARTIFACT_PATH")"
}

validate_release_path() {
  local candidate="$1" normalized parent name physical_parent
  require_absolute_path "release path" "$candidate"
  normalized="$(lexical_path "$candidate")"
  parent="$(dirname "$normalized")"
  name="$(basename "$normalized")"
  [[ "$parent" == "$RELEASE_ROOT" ]] || die "release path escapes RELEASE_ROOT: $normalized"
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] || die "release directory must use a full lowercase Git SHA: $normalized"
  [[ ! -L "$candidate" ]] || die "release directory must not be a symlink: $candidate"
  physical_parent="$(physical_path "$parent")"
  [[ "$physical_parent" == "$RELEASE_ROOT" ]] || die "release physical parent changed: $candidate"
}

validate_release_capabilities() {
  local target="$1" sha="$2" manifest_sha256="$3"
  validate_release_path "$target"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] ||
    die "release SHA must be a lowercase full SHA: $sha"
  [[ "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    die "release manifest SHA-256 is invalid for $sha"
  [[ "$(basename "$target")" == "$sha" ]] || die "release SHA/path mismatch: $target"
  [[ -f "$target/ecosystem.config.cjs" ]] || die "release lacks ecosystem config: $target"
  [[ -x "$target/scripts/verify-release.sh" ]] || die "release lacks executable verifier: $target"
  [[ -f "$target/.release-integrity.json" ]] ||
    die "release lacks build integrity manifest: $target"
  [[ -f "$target/app/api/health/route.ts" ]] || die "release lacks health source: $target"
  grep -Fq 'process.env.RELEASE_SHA' "$target/app/api/health/route.ts" ||
    die "release health route lacks full RELEASE_SHA capability: $target"
  node "$target/scripts/release-integrity.mjs" verify \
    "$target" "$sha" "$manifest_sha256" ||
    die "release runtime integrity verification failed: $target"
}

assert_release_git_state() {
  local target="$1" sha="$2" actual
  actual="$(git -C "$target" rev-parse HEAD)" ||
    die "cannot read release Git HEAD: $target"
  actual="${actual,,}"
  [[ "$actual" == "$sha" ]] || die "release Git HEAD mismatch: expected $sha, found $actual"
  git -C "$target" diff --quiet --ignore-submodules -- ||
    die "release has modified tracked files: $target"
  git -C "$target" diff --cached --quiet --ignore-submodules -- ||
    die "release index differs from HEAD: $target"
}

pm2_bounded() {
  timeout --signal=TERM --kill-after=5s "${PM2_TIMEOUT_SECONDS}s" pm2 "$@"
}

load_previous_release() {
  local pm2_manifest_sha
  [[ "$TRUSTED_CURRENT_SHA" =~ ^[0-9a-f]{40}$ ]] ||
    die "TRUSTED_CURRENT_SHA must come from the external release record"
  [[ "$TRUSTED_CURRENT_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
    die "TRUSTED_CURRENT_MANIFEST_SHA256 must come from the external release record"
  [[ -L "$CURRENT_LINK" ]] ||
    die "CURRENT_LINK is not a managed release symlink; follow docs/runbooks/atomic-release-bootstrap.md"
  previous_target="$(physical_path "$CURRENT_LINK")"
  [[ -d "$previous_target" ]] || die "CURRENT_LINK target does not exist: $previous_target"
  previous_sha="$(basename "$previous_target")"
  [[ "$previous_sha" == "$TRUSTED_CURRENT_SHA" ]] ||
    die "current release differs from the external release record"
  pm2_manifest_sha="$(
    read_pm2_release_manifest_sha "$previous_target" "$previous_sha"
  )" || die "cannot recover the trusted manifest SHA-256 for the current release"
  [[ "$pm2_manifest_sha" == "$TRUSTED_CURRENT_MANIFEST_SHA256" ]] ||
    die "PM2 manifest differs from the external release record"
  previous_manifest_sha="$TRUSTED_CURRENT_MANIFEST_SHA256"
  validate_release_capabilities \
    "$previous_target" "$previous_sha" "$previous_manifest_sha"
}

read_pm2_release_manifest_sha() {
  local target="$1" sha="$2" pm2_snapshot
  pm2_snapshot="$(pm2_bounded jlist)" || return 1
  PM2_TARGET="$target" PM2_RELEASE_SHA="$sha" PM2_NAME="$PM2_NAME" node -e '
    const fs = require("node:fs");
    let entries;
    let target;
    try {
      entries = JSON.parse(fs.readFileSync(0, "utf8"));
      target = fs.realpathSync(process.env.PM2_TARGET);
    } catch {
      process.exit(1);
    }
    if (!Array.isArray(entries)) process.exit(1);
    const matching = entries.filter((entry) => entry?.name === process.env.PM2_NAME);
    if (matching.length === 0) process.exit(1);
    const hashes = new Set();
    for (const entry of matching) {
      const env = entry?.pm2_env;
      if (!env || typeof env !== "object" || Array.isArray(env)) process.exit(1);
      if (
        env.RELEASE_SHA !== process.env.PM2_RELEASE_SHA ||
        typeof env.pm_cwd !== "string" ||
        fs.realpathSync(env.pm_cwd) !== target ||
        !/^[0-9a-f]{64}$/.test(env.RELEASE_MANIFEST_SHA256 ?? "")
      ) process.exit(1);
      hashes.add(env.RELEASE_MANIFEST_SHA256);
    }
    if (hashes.size !== 1) process.exit(1);
    process.stdout.write([...hashes][0]);
  ' <<< "$pm2_snapshot"
}

safe_remove_release_dir() {
  local candidate="$1" check_pm2="${2:-1}" current="" physical_parent
  validate_release_path "$candidate"
  physical_parent="$(physical_path "$(dirname "$candidate")")"
  [[ "$physical_parent" == "$RELEASE_ROOT" ]] || {
    warn "preserving release because physical parent validation failed: $candidate"
    return 1
  }
  if [[ -L "$CURRENT_LINK" ]]; then
    current="$(physical_path "$CURRENT_LINK" || true)"
  fi
  if [[ "$candidate" == "$current" || "$candidate" == "$previous_target" || "$candidate_pm2_may_be_active" -eq 1 ]]; then
    warn "preserving protected or potentially active release: $candidate"
    return 1
  fi
  if [[ "$check_pm2" -eq 1 ]] && pm2_references_release "$candidate"; then
    warn "preserving release referenced by PM2: $candidate"
    return 1
  fi
  [[ -e "$candidate" ]] || return 0
  if ! git -C "$SOURCE_REPO" worktree remove --force "$candidate"; then
    warn "git could not safely remove worktree; preserving it: $candidate"
    git -C "$SOURCE_REPO" worktree prune >/dev/null 2>&1 || true
    return 1
  fi
  git -C "$SOURCE_REPO" worktree prune >/dev/null 2>&1 || true
  [[ ! -e "$candidate" ]] || {
    warn "git reported success but release still exists; preserving it: $candidate"
    return 1
  }
}

pm2_references_release() {
  local candidate="$1" pm2_snapshot status
  pm2_snapshot="$(pm2_bounded jlist)" || return 0
  if PM2_CANDIDATE="$candidate" node -e '
    const fs = require("node:fs");
    let candidate;
    let entries;
    try {
      candidate = fs.realpathSync(process.env.PM2_CANDIDATE);
      entries = JSON.parse(fs.readFileSync(0, "utf8"));
    } catch {
      process.exit(2);
    }
    if (!Array.isArray(entries)) process.exit(2);
    const referenced = entries.some((entry) => {
      if (!entry || typeof entry !== "object") {
        process.exitCode = 2;
        return false;
      }
      const env = entry.pm2_env;
      if (!env || typeof env !== "object" || Array.isArray(env)) {
        process.exitCode = 2;
        return false;
      }
      if (typeof env.pm_cwd !== "string") {
        process.exitCode = 2;
        return false;
      }
      try {
        return fs.realpathSync(env.pm_cwd) === candidate;
      } catch {
        process.exitCode = 2;
        return false;
      }
    });
    if (referenced) process.exit(0);
    process.exit(process.exitCode === 2 ? 2 : 1);
  ' <<< "$pm2_snapshot"; then
    return 0
  else
    status=$?
    [[ "$status" -eq 1 ]] && return 1
    return 0
  fi
}

db_session() {
  local timeout_seconds="$1"
  shift
  timeout --signal=TERM --kill-after=5s "${timeout_seconds}s" \
    docker exec \
      -e "PGOPTIONS=-c lock_timeout=${DB_LOCK_TIMEOUT_MILLISECONDS}ms -c statement_timeout=${DB_STATEMENT_TIMEOUT_MILLISECONDS}ms" \
      -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
      -U postgres -d "$DB_NAME" "$@"
}

db() {
  db_session "$DB_COMMAND_TIMEOUT_SECONDS" "$@"
}

db_lease_session() {
  # The session itself is the lease. It must not expire while a valid deploy is
  # still running; response reads and cleanup remain independently bounded.
  docker exec \
    -e "PGOPTIONS=-c lock_timeout=${DB_LOCK_TIMEOUT_MILLISECONDS}ms -c statement_timeout=${DB_STATEMENT_TIMEOUT_MILLISECONDS}ms" \
    -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
    -U postgres -d "$DB_NAME" "$@"
}

docker_bounded() {
  timeout --signal=TERM --kill-after=5s "${DB_COMMAND_TIMEOUT_SECONDS}s" \
    docker "$@"
}

db_q() {
  db -Atqc "$1"
}

terminate_database_deploy_lease() {
  local attempt
  [[ -n "$DB_LEASE_PID" ]] || return 0
  kill -TERM "$DB_LEASE_PID" >/dev/null 2>&1 || true
  for attempt in {1..5}; do
    kill -0 "$DB_LEASE_PID" >/dev/null 2>&1 || break
    sleep 1
  done
  if kill -0 "$DB_LEASE_PID" >/dev/null 2>&1; then
    kill -KILL "$DB_LEASE_PID" >/dev/null 2>&1 || true
  fi
  wait "$DB_LEASE_PID" >/dev/null 2>&1 || true
  DB_LEASE_PID=""
  DB_LEASE_INPUT_FD=""
  DB_LEASE_OUTPUT_FD=""
  DB_LEASE_ACTIVE=0
}

acquire_database_deploy_lease() {
  local marker="" deadline remaining read_timeout request=""
  [[ "$DB_LEASE_ACTIVE" -eq 0 ]] || die "database deploy lease is already active"
  coproc DEPLOY_DB_LEASE_PROCESS { db_lease_session -Atq; }
  DB_LEASE_OUTPUT_FD="${DEPLOY_DB_LEASE_PROCESS[0]}"
  DB_LEASE_INPUT_FD="${DEPLOY_DB_LEASE_PROCESS[1]}"
  DB_LEASE_PID="$DEPLOY_DB_LEASE_PROCESS_PID"
  deadline=$((SECONDS + DATABASE_LEASE_WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    printf -v request \
      "select case when pg_try_advisory_lock(hashtextextended('%s', 0)) then 'DEPLOY_LEASE_ACQUIRED' else 'DEPLOY_LEASE_BUSY' end;\n" \
      "$MIGRATION_LEASE_KEY"
    if ! write_database_lease_request "$request"; then
      terminate_database_deploy_lease
      die "cannot request database deploy lease"
    fi
    remaining=$((deadline - SECONDS))
    read_timeout="$DB_RESPONSE_TIMEOUT_SECONDS"
    (( read_timeout > remaining )) && read_timeout="$remaining"
    if (( read_timeout <= 0 )) ||
      ! IFS= read -r -t "$read_timeout" marker <&"$DB_LEASE_OUTPUT_FD"; then
      terminate_database_deploy_lease
      die "database deploy lease response timed out"
    fi
    if [[ "$marker" == "DEPLOY_LEASE_ACQUIRED" ]]; then
      DB_LEASE_ACTIVE=1
      return 0
    fi
    [[ "$marker" == "DEPLOY_LEASE_BUSY" ]] || {
      terminate_database_deploy_lease
      die "database deploy lease returned an invalid response: $marker"
    }
    (( SECONDS < deadline )) && sleep 1
  done
  terminate_database_deploy_lease
  die "database deploy lease remained busy for ${DATABASE_LEASE_WAIT_SECONDS}s"
}

write_database_lease_request() {
  local request="$1" status=0
  trap '' PIPE
  { printf '%s' "$request" >&"$DB_LEASE_INPUT_FD"; } 2>/dev/null || status=$?
  trap - PIPE
  return "$status"
}

assert_database_deploy_lease() {
  local marker="" request=""
  if [[ "$DB_LEASE_ACTIVE" -ne 1 || -z "$DB_LEASE_PID" ]] ||
    ! kill -0 "$DB_LEASE_PID" >/dev/null 2>&1; then
    terminate_database_deploy_lease
    die "database deploy lease is no longer provably held"
  fi
  printf -v request \
    "select case when (select count(*) from pg_locks where pid = pg_backend_pid() and locktype = 'advisory' and mode = 'ExclusiveLock' and granted) = 1 then 'DEPLOY_LEASE_ALIVE' else 'DEPLOY_LEASE_MISSING' end;\n"
  if ! write_database_lease_request "$request"; then
    terminate_database_deploy_lease
    die "database deploy lease is no longer provably held"
  fi
  if ! IFS= read -r -t "$DB_RESPONSE_TIMEOUT_SECONDS" marker <&"$DB_LEASE_OUTPUT_FD" ||
    [[ "$marker" != "DEPLOY_LEASE_ALIVE" ]]; then
    terminate_database_deploy_lease
    die "database deploy lease is no longer provably held"
  fi
}

release_database_deploy_lease() {
  local marker="" request="" status=0
  [[ "$DB_LEASE_ACTIVE" -eq 1 ]] || return 0
  printf -v request \
    "select case when pg_advisory_unlock(hashtextextended('%s', 0)) then 'DEPLOY_LEASE_RELEASED' else 'DEPLOY_LEASE_MISSING' end;\n\\q\n" \
    "$MIGRATION_LEASE_KEY"
  if ! write_database_lease_request "$request"; then
    status=1
  elif ! IFS= read -r -t "$DB_RESPONSE_TIMEOUT_SECONDS" marker <&"$DB_LEASE_OUTPUT_FD" ||
    [[ "$marker" != "DEPLOY_LEASE_RELEASED" ]]; then
    status=1
  fi
  if [[ "$status" -eq 0 ]]; then
    terminate_database_deploy_lease
  else
    terminate_database_deploy_lease
  fi
  return "$status"
}

write_migration_manifest() {
  local migrations_dir="$1" output="$2" unsorted
  unsorted="${output}.unsorted"
  [[ -d "$migrations_dir" ]] || die "migration directory is missing: $migrations_dir"
  : > "$unsorted"
  if ! find "$migrations_dir" -mindepth 1 -maxdepth 1 -type f -name '*.sql' -print0 > "$unsorted"; then
    rm -f -- "$unsorted" "$output"
    die "migration enumeration failed"
  fi
  if ! sort -z "$unsorted" > "$output"; then
    rm -f -- "$unsorted" "$output"
    die "migration ordering failed"
  fi
  rm -f -- "$unsorted"
  [[ -s "$output" ]] || die "candidate contains no migration files"
}

parse_migration_identity() {
  local file="$1" base version content_sha256
  base="$(basename "$file")"
  [[ "$base" =~ ^([0-9]{14})_([0-9A-Za-z_.-]+)\.sql$ ]] ||
    die "migration filename must begin with an exact 14-digit version: $base"
  version="${BASH_REMATCH[1]}"
  [[ -z "${MIGRATION_VERSIONS[$version]:-}" ]] ||
    die "duplicate migration version $version: $base and ${MIGRATION_VERSIONS[$version]}"
  content_sha256="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$content_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    die "cannot hash migration content: $base"
  MIGRATION_VERSIONS[$version]="$base"
  MIGRATION_HASHES[$version]="$content_sha256"
}

validate_expand_header() {
  local file="$1"
  node "$release_dir/scripts/validate-expand-migration.mjs" "$file" ||
    die "expand migration validation failed: $(basename "$file")"
}

validate_postgrest_admin_urls() {
  node - "$POSTGREST_READY_URL" "$POSTGREST_METRICS_URL" \
    "$POSTGREST_SCHEMA_CACHE_URL" <<'NODE'
const [readyInput, metricsInput, schemaCacheInput] = process.argv.slice(2);
let ready;
let metrics;
let schemaCache;
try {
  ready = new URL(readyInput);
  metrics = new URL(metricsInput);
  schemaCache = new URL(schemaCacheInput);
} catch {
  process.exit(1);
}
const loopbackHosts = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);
const safe = [ready, metrics, schemaCache].every(
  (url) =>
    url.protocol === "http:" &&
    loopbackHosts.has(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "",
);
if (
  !safe ||
  new Set([ready.origin, metrics.origin, schemaCache.origin]).size !== 1 ||
  ready.pathname !== "/ready" ||
  metrics.pathname !== "/metrics" ||
  schemaCache.pathname !== "/schema_cache"
) {
  process.exit(1);
}
NODE
}

preflight_migration_ledgers() {
  local file base version supabase_present custom_present public_legacy_present
  local sentinel_count security_ok supabase_applied custom_filename custom_version
  local custom_hash expected_hash
  local supabase_rows custom_rows row_filename row_version row_hash
  PENDING_MIGRATIONS=()
  BOOTSTRAP_FILENAMES=()
  MIGRATION_VERSIONS=()
  MIGRATION_HASHES=()
  SUPABASE_LEDGER_VERSIONS=()
  CUSTOM_LEDGER_FILES=()
  CUSTOM_LEDGER_HASHES=()
  PENDING_VERSIONS=()

  [[ "$DB_NAME" =~ ^[0-9A-Za-z_-]+$ ]] || die "DB_NAME contains unsafe characters"
  docker_bounded inspect "$DB_CONTAINER" >/dev/null 2>&1 ||
    die "database container was not found: $DB_CONTAINER"
  supabase_present="$(db_q "select to_regclass('supabase_migrations.schema_migrations') is not null")"
  [[ "$supabase_present" == "t" ]] ||
    die "no trusted Supabase migration ledger; follow docs/runbooks/atomic-release-bootstrap.md"
  custom_present="$(db_q "select to_regclass('deploy_internal.schema_migrations') is not null")"
  public_legacy_present="$(db_q "select to_regclass('public.deploy_migrations') is not null")"
  [[ "$public_legacy_present" != "t" ]] ||
    die "legacy public deploy ledger must be secured and moved; follow docs/runbooks/atomic-release-bootstrap.md"

  while IFS= read -r -d '' file; do
    parse_migration_identity "$file"
  done < "$migration_manifest"

  supabase_rows="$(db_q "select version from supabase_migrations.schema_migrations order by version")" ||
    die "cannot read Supabase migration ledger"
  while IFS= read -r row_version; do
    [[ -z "$row_version" ]] && continue
    [[ "$row_version" =~ ^[0-9]{14}$ ]] || die "invalid version in Supabase migration ledger: $row_version"
    [[ -n "${MIGRATION_VERSIONS[$row_version]:-}" ]] ||
      die "Supabase ledger version has no exact candidate migration file: $row_version"
    SUPABASE_LEDGER_VERSIONS[$row_version]=1
  done <<< "$supabase_rows"

  if [[ "$custom_present" == "t" ]]; then
    security_ok="$(db_q "
      select
        pg_get_userbyid(c.relowner) = current_user
        and c.relrowsecurity
        and c.relforcerowsecurity
        and c.relkind = 'r'
        and not exists (
          select 1
          from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
          where acl.grantee <> c.relowner
        )
        and pg_get_userbyid(n.nspowner) = current_user
        and not exists (
          select 1
          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
          where acl.grantee <> n.nspowner
        )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'deploy_internal' and c.relname = 'schema_migrations'
    ")"
    [[ "$security_ok" == "t" ]] ||
      die "internal deploy ledger owner, RLS, or ACL is unsafe; follow docs/runbooks/atomic-release-bootstrap.md"
    sentinel_count="$(db_q "select count(*) from deploy_internal.schema_migrations where filename='$BOOTSTRAP_SENTINEL' and version='$BOOTSTRAP_VERSION' and content_sha256='$BOOTSTRAP_CONTENT_SHA256'")"
    [[ "$sentinel_count" == "1" ]] ||
      die "deploy ledger lacks exactly one trusted bootstrap sentinel"
    custom_ledger_state="trusted"
    custom_rows="$(db_q "select filename || E'\\t' || version || E'\\t' || content_sha256 from deploy_internal.schema_migrations order by version, filename")" ||
      die "cannot read custom migration ledger"
    while IFS=$'\t' read -r row_filename row_version row_hash; do
      [[ -z "$row_filename" ]] && continue
      if [[ "$row_filename" == "$BOOTSTRAP_SENTINEL" &&
        "$row_version" == "$BOOTSTRAP_VERSION" &&
        "$row_hash" == "$BOOTSTRAP_CONTENT_SHA256" ]]; then
        continue
      fi
      [[ "$row_filename" =~ ^([0-9]{14})_([0-9A-Za-z_.-]+)\.sql$ ]] ||
        die "invalid filename in custom migration ledger: $row_filename"
      [[ "${BASH_REMATCH[1]}" == "$row_version" ]] ||
        die "custom ledger version/filename mismatch: $row_filename / $row_version"
      [[ "${MIGRATION_VERSIONS[$row_version]:-}" == "$row_filename" ]] ||
        die "custom ledger row has no exact candidate mapping: $row_filename"
      [[ "$row_hash" == "${MIGRATION_HASHES[$row_version]:-}" ]] ||
        die "migration content hash drifted for $row_filename"
      [[ -n "${SUPABASE_LEDGER_VERSIONS[$row_version]:-}" ]] ||
        die "custom ledger row is absent from Supabase ledger: $row_filename"
      [[ -z "${CUSTOM_LEDGER_FILES[$row_version]:-}" ]] ||
        die "duplicate custom ledger version: $row_version"
      CUSTOM_LEDGER_FILES[$row_version]="$row_filename"
      CUSTOM_LEDGER_HASHES[$row_version]="$row_hash"
    done <<< "$custom_rows"
  else
    custom_ledger_state="absent"
  fi

  while IFS= read -r -d '' file; do
    base="$(basename "$file")"
    version="${base%%_*}"
    supabase_applied="f"
    [[ -n "${SUPABASE_LEDGER_VERSIONS[$version]:-}" ]] && supabase_applied="t"
    if [[ "$custom_ledger_state" == "trusted" ]]; then
      custom_filename="${CUSTOM_LEDGER_FILES[$version]:-}"
      custom_hash="${CUSTOM_LEDGER_HASHES[$version]:-}"
      expected_hash="${MIGRATION_HASHES[$version]}"
      custom_version="f"
      [[ "$custom_filename" == "$base" ]] && custom_version="t"
      [[ "$supabase_applied" == "$custom_version" ]] ||
        die "migration ledger mismatch for version $version: supabase=$supabase_applied custom=$custom_filename"
      [[ "$supabase_applied" != "t" || "$custom_hash" == "$expected_hash" ]] ||
        die "migration content hash mismatch for version $version"
    else
      custom_version="$supabase_applied"
      [[ "$supabase_applied" == "t" ]] && BOOTSTRAP_FILENAMES+=("$base")
    fi
    if [[ "$supabase_applied" != "t" ]]; then
      PENDING_MIGRATIONS+=("$file")
      PENDING_VERSIONS[$version]=1
    fi
  done < "$migration_manifest"

  for file in "${PENDING_MIGRATIONS[@]}"; do
    validate_expand_header "$file"
  done
  validate_postgrest_admin_urls ||
    die "loopback PostgREST /ready, /metrics, and /schema_cache URLs on one admin origin are required"
}

read_postgrest_schema_cache_generation() {
  timeout --signal=TERM --kill-after=5s 10s curl --fail --silent --show-error \
    --connect-timeout 2 --max-time 5 "$POSTGREST_METRICS_URL" |
    node -e '
      const fs = require("node:fs");
      const lines = fs.readFileSync(0, "utf8").split(/\r?\n/);
      const match = lines
        .filter((line) => line.startsWith("pgrst_schema_cache_loads_total{"))
        .find((line) => /status="SUCCESS"/.test(line))
        ?.match(/\s([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/);
      if (!match || !Number.isFinite(Number(match[1]))) process.exit(1);
      process.stdout.write(match[1]);
    '
}

postgrest_schema_cache_contains_probe() {
  local probe_name="$1"
  timeout --signal=TERM --kill-after=5s 10s curl --fail --silent --show-error \
    --connect-timeout 2 --max-time 5 "$POSTGREST_SCHEMA_CACHE_URL" |
    node -e '
      const fs = require("node:fs");
      const probe = process.argv[1];
      let root;
      try {
        root = JSON.parse(fs.readFileSync(0, "utf8"));
      } catch {
        process.exit(1);
      }
      const expected = new Set([probe, `public.${probe}`]);
      const seen = new Set();
      const pending = [root];
      while (pending.length > 0) {
        const value = pending.pop();
        if (typeof value === "string") {
          if (expected.has(value)) process.exit(0);
          continue;
        }
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        if (Array.isArray(value)) {
          pending.push(...value);
          continue;
        }
        for (const [key, child] of Object.entries(value)) {
          if (expected.has(key)) process.exit(0);
          pending.push(child);
        }
      }
      process.exit(1);
    ' "$probe_name"
}

wait_for_postgrest_schema_cache() {
  local before_generation="$1" probe_name="$2" attempt after_generation=""
  for attempt in {1..25}; do
    if timeout --signal=TERM --kill-after=5s 5s curl --fail --silent --show-error \
      --connect-timeout 2 --max-time 3 "$POSTGREST_READY_URL" >/dev/null; then
      after_generation="$(read_postgrest_schema_cache_generation || true)"
      if node -e '
        const [before, after] = process.argv.slice(1).map(Number);
        process.exit(Number.isFinite(before) && Number.isFinite(after) && after > before ? 0 : 1);
      ' "$before_generation" "$after_generation" &&
        postgrest_schema_cache_contains_probe "$probe_name"; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

emit_internal_ledger_security_sql() {
  cat <<'SQL'
create schema if not exists deploy_internal authorization current_user;
revoke all on schema deploy_internal from public;
do $deploy_roles$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema deploy_internal from %I', role_name);
    end if;
  end loop;
end
$deploy_roles$;
create table if not exists deploy_internal.schema_migrations (
  filename text primary key,
  version text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
create table if not exists deploy_internal.backfill_progress (
  task_name text primary key,
  migration_version text not null,
  cursor_uuid uuid,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table deploy_internal.schema_migrations enable row level security;
alter table deploy_internal.schema_migrations force row level security;
alter table deploy_internal.backfill_progress enable row level security;
alter table deploy_internal.backfill_progress force row level security;
revoke all on table deploy_internal.schema_migrations from public;
revoke all on table deploy_internal.backfill_progress from public;
do $deploy_roles$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'revoke all on table deploy_internal.schema_migrations from %I',
        role_name
      );
      execute format(
        'revoke all on table deploy_internal.backfill_progress from %I',
        role_name
      );
    end if;
  end loop;
end
$deploy_roles$;
SQL
}

emit_locked_ledger_assertion_sql() {
  cat <<'SQL'
do $deploy_assert$
begin
  if not exists (
    select 1
    from pg_namespace n
    where n.nspname = 'deploy_internal'
      and pg_get_userbyid(n.nspowner) = current_user
      and not exists (
        select 1
        from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
        where acl.grantee <> n.nspowner
      )
  ) then
    raise exception 'deploy_internal schema owner or ACL is unsafe';
  end if;
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'deploy_internal'
      and c.relname = 'schema_migrations'
      and c.relkind = 'r'
      and pg_get_userbyid(c.relowner) = current_user
      and c.relrowsecurity
      and c.relforcerowsecurity
      and not exists (
        select 1
        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        where acl.grantee <> c.relowner
      )
  ) then
    raise exception 'internal deploy ledger owner, RLS, or ACL is unsafe';
  end if;
  if to_regclass('public.deploy_migrations') is not null then
    raise exception 'legacy public deploy ledger must be moved before deployment';
  end if;
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'deploy_internal'
      and c.relname = 'backfill_progress'
      and c.relkind = 'r'
      and pg_get_userbyid(c.relowner) = current_user
      and c.relrowsecurity
      and c.relforcerowsecurity
      and not exists (
        select 1
        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        where acl.grantee <> c.relowner
      )
  ) then
    raise exception 'internal backfill progress owner, RLS, or ACL is unsafe';
  end if;
  if (
    select count(*)
    from deploy_internal.schema_migrations
    where filename = '__atomic_release_bootstrap_v1__'
      and version = 'bootstrap-v1'
      and content_sha256 =
        '0000000000000000000000000000000000000000000000000000000000000000'
  ) <> 1 then
    raise exception 'internal deploy ledger bootstrap sentinel is invalid';
  end if;
  if exists (
    select 1
    from supabase_migrations.schema_migrations native
    left join expected_deploy_migrations expected using (version)
    where expected.version is null
  ) then
    raise exception 'Supabase ledger contains a version outside the candidate manifest';
  end if;
  if exists (
    select 1
    from deploy_internal.schema_migrations internal
    left join expected_deploy_migrations expected
      on expected.version = internal.version
     and expected.filename = internal.filename
     and expected.content_sha256 = internal.content_sha256
    left join supabase_migrations.schema_migrations native
      on native.version = internal.version
    where internal.filename <> '__atomic_release_bootstrap_v1__'
      and (expected.version is null or native.version is null)
  ) then
    raise exception 'internal deploy ledger does not exactly match candidate and Supabase ledgers';
  end if;
  if exists (
    select 1
    from supabase_migrations.schema_migrations native
    join expected_deploy_migrations expected using (version)
    left join deploy_internal.schema_migrations internal
      on internal.version = expected.version
     and internal.filename = expected.filename
     and internal.content_sha256 = expected.content_sha256
    where internal.version is null
  ) then
    raise exception 'Supabase ledger row is absent from the internal deploy ledger';
  end if;
end
$deploy_assert$;
SQL
}

apply_migrations() {
  local file base version name content_sha256 output applied=0 schema_cache_before=""
  local schema_probe=""
  [[ "$DB_LEASE_ACTIVE" -eq 1 ]] ||
    die "database deploy lease must cover the migration batch and schema-cache proof"
  assert_database_deploy_lease
  [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] ||
    die "TARGET_SHA must be set before applying migrations"
  schema_probe="deploy_schema_probe_${TARGET_SHA}"
  schema_cache_before="$(read_postgrest_schema_cache_generation)" ||
    die "cannot read the pre-migration PostgREST schema-cache generation"
  [[ "$schema_cache_before" =~ ^[-+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$ ]] ||
    die "invalid pre-migration PostgREST schema-cache generation"

  output="$({
    printf 'begin;\n'
    printf "set local lock_timeout = '%sms';\n" "$DB_LOCK_TIMEOUT_MILLISECONDS"
    printf "set local statement_timeout = '%sms';\n" "$DB_STATEMENT_TIMEOUT_MILLISECONDS"
    printf "select pg_advisory_xact_lock(hashtextextended('%s', 0));\n" "$MIGRATION_LOCK_KEY"
    printf 'lock table supabase_migrations.schema_migrations in share row exclusive mode;\n'
    printf 'create temporary table expected_deploy_migrations (version text primary key, filename text not null unique, name text not null, content_sha256 text not null) on commit drop;\n'
    while IFS= read -r -d '' file; do
      base="$(basename "$file")"
      version="${base%%_*}"
      name="${base#*_}"
      name="${name%.sql}"
      content_sha256="${MIGRATION_HASHES[$version]}"
      printf "insert into expected_deploy_migrations(version, filename, name, content_sha256) values ('%s', '%s', '%s', '%s');\n" \
        "$version" "$base" "$name" "$content_sha256"
    done < "$migration_manifest"
    emit_internal_ledger_security_sql
    printf 'lock table deploy_internal.schema_migrations in share row exclusive mode;\n'
    printf "insert into deploy_internal.schema_migrations(filename, version, content_sha256) select expected.filename, expected.version, expected.content_sha256 from expected_deploy_migrations expected join supabase_migrations.schema_migrations native using (version) on conflict (version) do nothing;\n"
    printf "insert into deploy_internal.schema_migrations(filename, version, content_sha256) values ('%s', '%s', '%s') on conflict (filename) do nothing;\n" \
      "$BOOTSTRAP_SENTINEL" "$BOOTSTRAP_VERSION" "$BOOTSTRAP_CONTENT_SHA256"
    emit_locked_ledger_assertion_sql

    while IFS= read -r -d '' file; do
      base="$(basename "$file")"
      version="${base%%_*}"
      name="${base#*_}"
      name="${name%.sql}"
      content_sha256="${MIGRATION_HASHES[$version]}"
      if [[ -n "${PENDING_VERSIONS[$version]:-}" ]]; then
        printf "select not exists(select 1 from supabase_migrations.schema_migrations where version='%s') as should_apply \\gset\n" "$version"
        printf '\\if :should_apply\n'
        cat "$file"
        printf "\ninsert into deploy_internal.schema_migrations(filename, version, content_sha256) values ('%s', '%s', '%s') on conflict (version) do nothing;\n" "$base" "$version" "$content_sha256"
        printf "insert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s');\n" "$version" "$name"
        printf "select 'APPLIED:%s';\n" "$base"
        printf '\\else\n'
        printf "select 'SKIPPED:%s';\n" "$base"
        printf '\\endif\n'
      else
        printf "do \$\$ begin if not exists(select 1 from supabase_migrations.schema_migrations where version='%s') then raise exception 'previously applied migration disappeared: %s'; end if; end \$\$;\n" "$version" "$base"
        printf "select 'SKIPPED:%s';\n" "$base"
      fi
    done < "$migration_manifest"
    emit_locked_ledger_assertion_sql
    printf "do \$deploy_probe\$ declare probe record; role_name text; begin "
    printf "for probe in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'deploy_schema_probe_%%' and c.relname <> '%s' loop execute format('drop view public.%%I', probe.relname); end loop; " "$schema_probe"
    printf "execute format('create or replace view public.%%I as select %%L::text as release_sha', '%s', '%s'); " "$schema_probe" "$TARGET_SHA"
    printf "execute format('revoke all on public.%%I from public', '%s'); " "$schema_probe"
    printf "foreach role_name in array array['anon', 'authenticated', 'service_role'] loop if exists(select 1 from pg_roles where rolname = role_name) then execute format('revoke all on public.%%I from %%I', '%s', role_name); end if; end loop; end \$deploy_probe\$;\n" "$schema_probe"
    printf "select pg_notify('pgrst', 'reload schema');\n"
    printf 'commit;\n'
  } | db -Atq)" || die "serialized migration batch failed"

  applied="$(grep -c '^APPLIED:' <<< "$output" || true)"
  wait_for_postgrest_schema_cache "$schema_cache_before" "$schema_probe" ||
    die "PostgREST did not expose this target's schema probe in a newer ready cache within 25 seconds"
  assert_database_deploy_lease
  log "Migrations complete ($applied newly applied)"
}

run_ai_turn_stage_telemetry_backfill() {
  local migration_applied schema_ready progress_state progress_version completed
  local constraint_validated batch_result batch_count cursor_uuid pending

  migration_applied="$(db_q "
    select exists (
      select 1
      from supabase_migrations.schema_migrations
      where version = '$AI_TURN_TELEMETRY_BACKFILL_VERSION'
    )
  ")" || die "cannot read the telemetry backfill migration state"
  [[ "$migration_applied" == "t" ]] || return 0

  assert_database_deploy_lease ||
    die "database deploy lease is no longer provably held during telemetry backfill"
  schema_ready="$(db_q "
    select
      to_regclass('public.ai_chat_turns') is not null
      and exists (
        select 1
        from pg_attribute
        where attrelid = 'public.ai_chat_turns'::regclass
          and attname = 'accepted_at'
          and not attisdropped
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.ai_chat_turns'::regclass
          and conname = 'ai_chat_turns_session_action_check'
      )
      and exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'deploy_internal'
          and c.relname = 'backfill_progress'
          and c.relkind = 'r'
          and pg_get_userbyid(c.relowner) = current_user
          and c.relrowsecurity
          and c.relforcerowsecurity
          and not exists (
            select 1
            from aclexplode(
              coalesce(c.relacl, acldefault('r', c.relowner))
            ) acl
            where acl.grantee <> c.relowner
          )
      )
  ")" || die "cannot inspect the telemetry backfill schema"
  [[ "$schema_ready" == "t" ]] ||
    die "telemetry backfill migration is ledgered but its schema is incomplete"

  db -Atqc "
    insert into deploy_internal.backfill_progress(
      task_name, migration_version
    ) values (
      '$AI_TURN_TELEMETRY_BACKFILL_TASK',
      '$AI_TURN_TELEMETRY_BACKFILL_VERSION'
    ) on conflict (task_name) do nothing
  " >/dev/null || die "cannot initialize telemetry backfill progress"
  progress_state="$(db_q "
    select migration_version || '|' || (completed_at is not null)::text
    from deploy_internal.backfill_progress
    where task_name = '$AI_TURN_TELEMETRY_BACKFILL_TASK'
  ")" || die "cannot read telemetry backfill progress"
  IFS='|' read -r progress_version completed <<< "$progress_state"
  [[ "$progress_version" == "$AI_TURN_TELEMETRY_BACKFILL_VERSION" ]] ||
    die "telemetry backfill progress has an unexpected migration version"
  if [[ "$completed" == "true" ]]; then
    constraint_validated="$(db_q "
      select convalidated
      from pg_constraint
      where conrelid = 'public.ai_chat_turns'::regclass
        and conname = 'ai_chat_turns_session_action_check'
    ")" || die "cannot verify completed telemetry validation"
    [[ "$constraint_validated" == "t" ]] ||
      die "telemetry backfill is marked complete without validation"
    return 0
  fi
  [[ "$completed" == "false" ]] ||
    die "telemetry backfill completion state is invalid"

  while true; do
    batch_result="$(db_q "
      with progress as materialized (
        select cursor_uuid
        from deploy_internal.backfill_progress
        where task_name = '$AI_TURN_TELEMETRY_BACKFILL_TASK'
        for update
      ), backfill_batch as materialized (
        select historical_turn.id
        from public.ai_chat_turns historical_turn
        cross join progress
        where historical_turn.accepted_at is null
          and (
            progress.cursor_uuid is null
            or historical_turn.id > progress.cursor_uuid
          )
        order by historical_turn.id
        limit $AI_TURN_TELEMETRY_BACKFILL_BATCH_SIZE
        for update of historical_turn skip locked
      ), updated as (
        update public.ai_chat_turns backfill_turn
        set accepted_at = backfill_turn.created_at
        from backfill_batch
        where backfill_turn.id = backfill_batch.id
          and backfill_turn.accepted_at is null
        returning backfill_turn.id
      ), advanced as (
        update deploy_internal.backfill_progress task_progress
        set cursor_uuid = (
              select updated.id
              from updated
              order by updated.id desc
              limit 1
            ),
            updated_at = statement_timestamp()
        where task_progress.task_name = '$AI_TURN_TELEMETRY_BACKFILL_TASK'
          and exists (select 1 from updated)
        returning task_progress.cursor_uuid
      )
      select
        (select count(*) from updated) || '|' ||
        coalesce(
          (select cursor_uuid::text from advanced),
          (select cursor_uuid::text from progress),
          ''
        )
    ")" || die "telemetry backfill batch failed"
    IFS='|' read -r batch_count cursor_uuid <<< "$batch_result"
    [[ "$batch_count" =~ ^[0-9]+$ ]] ||
      die "telemetry backfill returned an invalid batch count"
    (( batch_count <= AI_TURN_TELEMETRY_BACKFILL_BATCH_SIZE )) ||
      die "telemetry backfill exceeded its transaction batch bound"

    assert_database_deploy_lease ||
      die "database deploy lease is no longer provably held during telemetry backfill"
    [[ "$batch_count" == "0" ]] || continue

    pending="$(db_q "
      select exists (
        select 1
        from public.ai_chat_turns
        where accepted_at is null
      )
    ")" || die "cannot verify telemetry backfill completion"
    [[ "$pending" == "t" || "$pending" == "f" ]] ||
      die "telemetry backfill returned an invalid completion state"
    [[ "$pending" == "t" ]] || break
    [[ -n "$cursor_uuid" ]] ||
      die "telemetry backfill made no progress"
    db -Atqc "
      update deploy_internal.backfill_progress
      set cursor_uuid = null,
          updated_at = statement_timestamp()
      where task_name = '$AI_TURN_TELEMETRY_BACKFILL_TASK'
    " >/dev/null || die "cannot restart telemetry backfill cursor"
    assert_database_deploy_lease ||
      die "database deploy lease is no longer provably held during telemetry backfill"
  done

  assert_database_deploy_lease ||
    die "database deploy lease is no longer provably held before telemetry validation"
  constraint_validated="$(db_q "
    select convalidated
    from pg_constraint
    where conrelid = 'public.ai_chat_turns'::regclass
      and conname = 'ai_chat_turns_session_action_check'
  ")" || die "cannot verify telemetry constraint validation"
  if [[ "$constraint_validated" == "f" ]]; then
    db -Atqc "alter table public.ai_chat_turns validate constraint ai_chat_turns_session_action_check" >/dev/null ||
      die "telemetry constraint validation failed"
  elif [[ "$constraint_validated" != "t" ]]; then
    die "telemetry constraint validation state is invalid"
  fi
  pending="$(db_q "
    select
      exists (
        select 1
        from public.ai_chat_turns
        where accepted_at is null
      )
      or not (
        select convalidated
        from pg_constraint
        where conrelid = 'public.ai_chat_turns'::regclass
          and conname = 'ai_chat_turns_session_action_check'
      )
  ")" || die "cannot verify telemetry backfill and validation"
  [[ "$pending" == "f" ]] ||
    die "telemetry backfill or validation remains incomplete"
  assert_database_deploy_lease ||
    die "database deploy lease is no longer provably held after telemetry validation"
  db -Atqc "
    update deploy_internal.backfill_progress
    set completed_at = coalesce(completed_at, statement_timestamp()),
        updated_at = statement_timestamp()
    where task_name = '$AI_TURN_TELEMETRY_BACKFILL_TASK'
      and completed_at is null
  " >/dev/null || die "cannot mark telemetry backfill complete"
  assert_database_deploy_lease ||
    die "database deploy lease is no longer provably held after telemetry completion"
  log "AI turn telemetry backfill and validation complete"
}

atomic_switch_current() {
  local next_link="${CURRENT_LINK}.next"
  if [[ -e "$next_link" || -L "$next_link" ]]; then
    [[ -L "$next_link" ]] || die "temporary current path is not a symlink: $next_link"
    rm -- "$next_link"
  fi
  ln -sfn "$release_dir" "$next_link"
  mv -Tf "$next_link" "$CURRENT_LINK"
  current_switched=1
}

rollback_current() {
  local rollback_link="${CURRENT_LINK}.rollback"
  [[ -n "$previous_target" && -n "$previous_sha" ]] || die "no validated previous release is available"
  validate_release_capabilities \
    "$previous_target" "$previous_sha" "$previous_manifest_sha"
  if [[ -e "$rollback_link" || -L "$rollback_link" ]]; then
    [[ -L "$rollback_link" ]] || die "rollback temporary path is not a symlink: $rollback_link"
    rm -- "$rollback_link"
  fi
  ln -sfn "$previous_target" "$rollback_link"
  mv -Tf "$rollback_link" "$CURRENT_LINK"
  current_switched=0
}

reload_pm2() {
  local sha="$1" manifest_sha256="$2"
  CURRENT_LINK="$CURRENT_LINK" PM2_NAME="$PM2_NAME" RELEASE_SHA="$sha" \
    RELEASE_MANIFEST_SHA256="$manifest_sha256" \
    pm2_bounded startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
}

save_pm2() {
  pm2_bounded save
}

verify_release() {
  local sha="$1" manifest_sha256="$2" current_target
  [[ -L "$CURRENT_LINK" ]] || die "CURRENT_LINK is not a managed release symlink"
  current_target="$(physical_path "$CURRENT_LINK")"
  validate_release_capabilities "$current_target" "$sha" "$manifest_sha256"
  CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" PM2_NAME="$PM2_NAME" \
    PM2_TIMEOUT_SECONDS="$PM2_TIMEOUT_SECONDS" HEALTH_URL="$HEALTH_URL" \
    "$current_target/scripts/verify-release.sh" "$sha" "$manifest_sha256"
}

rollback_after_activation_failure() {
  # Application rollback does not roll back already committed expand migrations.
  warn "Restoring previous application release; committed expand migrations remain"
  if ! rollback_current; then
    warn "Rollback symlink failed; preserving both releases for recovery"
    return 1
  fi
  if ! reload_pm2 "$previous_sha" "$previous_manifest_sha"; then
    warn "Previous PM2 reload failed; preserving both releases for recovery"
    return 1
  fi
  if ! verify_release "$previous_sha" "$previous_manifest_sha"; then
    warn "Previous release exact verification failed; preserving both releases for recovery"
    return 1
  fi
  if ! save_pm2; then
    warn "Previous release is running but pm2 save failed; preserving both releases"
    return 1
  fi
  candidate_pm2_may_be_active=0
  return 0
}

write_release_cleanup_manifest() {
  local output="$1" unsorted
  unsorted="${output}.unsorted"
  : > "$unsorted"
  if ! find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d \
    -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\0' > "$unsorted"; then
    rm -f -- "$unsorted" "$output"
    die "release cleanup enumeration failed"
  fi
  if ! sort -zrn "$unsorted" > "$output"; then
    rm -f -- "$unsorted" "$output"
    die "release cleanup ordering failed"
  fi
  rm -f -- "$unsorted"
}

cleanup_old_releases() {
  local seen=0 entry path current
  release_cleanup_manifest="$(mktemp "$RELEASE_ROOT/.cleanup.XXXXXX")"
  write_release_cleanup_manifest "$release_cleanup_manifest"
  current="$(physical_path "$CURRENT_LINK")"
  while IFS= read -r -d '' entry; do
    path="${entry#* }"
    validate_release_path "$path"
    seen=$((seen + 1))
    if [[ "$path" == "$current" || "$path" == "$previous_target" ]]; then
      continue
    fi
    if [[ "$seen" -le "$KEEP_RELEASES" ]]; then
      continue
    fi
    safe_remove_release_dir "$path" || warn "release cleanup preserved $path"
  done < "$release_cleanup_manifest"
}

cleanup_temp_manifests() {
  [[ -z "$migration_manifest" ]] || rm -f -- "$migration_manifest" "${migration_manifest}.unsorted"
  [[ -z "$release_cleanup_manifest" ]] || rm -f -- "$release_cleanup_manifest" "${release_cleanup_manifest}.unsorted"
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    set +e
    if [[ "$current_switched" -eq 1 || "$candidate_pm2_may_be_active" -eq 1 ]]; then
      if ! rollback_after_activation_failure; then
        candidate_cleanup_intended=0
      fi
    fi
    if [[ "$DB_LEASE_ACTIVE" -eq 1 ]]; then
      release_database_deploy_lease ||
        warn "database deploy lease connection required forced termination"
    fi
    if [[ "$candidate_cleanup_intended" -eq 1 && "$candidate_pm2_may_be_active" -eq 0 && -n "$release_dir" ]]; then
      safe_remove_release_dir "$release_dir" "$candidate_activation_attempted" ||
        warn "candidate preserved for manual inspection: $release_dir"
    fi
    warn "Deployment failed. Database expand migrations are not rolled back."
  fi
  cleanup_temp_manifests
  exit "$status"
}

main() {
  trap on_exit EXIT
  [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] ||
    die "EXPECTED_SHA must be the reviewed full lowercase Git SHA"
  [[ "$EXPECTED_RELEASE_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
    die "EXPECTED_RELEASE_MANIFEST_SHA256 must come from the trusted CI artifact"
  [[ "$EXPECTED_RELEASE_ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
    die "EXPECTED_RELEASE_ARTIFACT_SHA256 must come from the trusted CI artifact"
  [[ "$TRUSTED_CURRENT_SHA" =~ ^[0-9a-f]{40}$ ]] ||
    die "TRUSTED_CURRENT_SHA must come from the external release record"
  [[ "$TRUSTED_CURRENT_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
    die "TRUSTED_CURRENT_MANIFEST_SHA256 must come from the external release record"
  validate_runtime
  validate_secure_env_file
  load_runtime_env
  validate_control_paths
  validate_release_artifact
  acquire_deploy_lock
  validate_source_repo
  load_previous_release

  git -C "$SOURCE_REPO" fetch origin "$BRANCH"
  TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")"
  TARGET_SHA="${TARGET_SHA,,}"
  [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "target is not a full Git SHA: $TARGET_SHA"
  [[ "$TARGET_SHA" == "$EXPECTED_SHA" ]] ||
    die "branch head moved: expected $EXPECTED_SHA, found $TARGET_SHA"
  release_dir="$RELEASE_ROOT/$TARGET_SHA"
  validate_release_path "$release_dir"
  [[ "$release_dir" != "$previous_target" ]] || die "target release is already current: $TARGET_SHA"

  [[ ! -e "$release_dir" ]] ||
    die "target release directory already exists; verify PM2 references and remove it manually: $release_dir"

  candidate_cleanup_intended=1
  log "Creating immutable candidate $TARGET_SHA"
  git -C "$SOURCE_REPO" worktree add --detach "$release_dir" "$TARGET_SHA"
  assert_release_git_state "$release_dir" "$TARGET_SHA"

  log "Extracting the exact reviewed CI runtime artifact"
  node "$release_dir/scripts/extract-release-artifact.mjs" \
    "$RELEASE_ARTIFACT_PATH" "$release_dir" \
    "$EXPECTED_RELEASE_ARTIFACT_SHA256" "$TARGET_SHA"
  assert_release_git_state "$release_dir" "$TARGET_SHA"
  actual_manifest_sha256="$(
    sha256sum "$release_dir/.release-integrity.json" | awk '{print $1}'
  )"
  [[ "$actual_manifest_sha256" == "$EXPECTED_RELEASE_MANIFEST_SHA256" ]] ||
    die "extracted release manifest differs from the trusted CI artifact"
  validate_release_capabilities \
    "$release_dir" "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256"

  migration_manifest="$(mktemp "$RELEASE_ROOT/.migrations.$TARGET_SHA.XXXXXX")"
  write_migration_manifest "$release_dir/supabase/migrations" "$migration_manifest"
  acquire_database_deploy_lease
  assert_database_deploy_lease
  preflight_migration_ledgers
  apply_migrations
  run_ai_turn_stage_telemetry_backfill

  log "Atomically switching current release to $TARGET_SHA"
  assert_database_deploy_lease
  atomic_switch_current
  candidate_activation_attempted=1
  candidate_pm2_may_be_active=1
  if ! reload_pm2 "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256" ||
    ! verify_release "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256" ||
    ! save_pm2; then
    if rollback_after_activation_failure; then
      safe_remove_release_dir "$release_dir" || warn "rolled-back candidate was preserved"
      candidate_cleanup_intended=0
    else
      candidate_cleanup_intended=0
    fi
    die "new application release failed activation and was not persisted"
  fi
  release_database_deploy_lease ||
    warn "release is persisted; database deploy lease required forced termination"

  candidate_pm2_may_be_active=0
  current_switched=0
  candidate_cleanup_intended=0
  if ! ( trap cleanup_temp_manifests EXIT; cleanup_old_releases ); then
    warn "Release is verified and persisted; old release cleanup is deferred"
  fi
  log "Deployment verified and persisted at $TARGET_SHA"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
