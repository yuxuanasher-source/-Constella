#!/usr/bin/env bash
# Atomic production deployment:
#   secure env + host lock -> immutable candidate build -> read-only migration
#   preflight -> transactionally serialized expand migrations -> atomic symlink
#   switch -> exact release verification -> persistent PM2 state.
set -Eeuo pipefail
umask 077
export LC_ALL=C

DEPLOY_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

SOURCE_REPO="${SOURCE_REPO:-/var/www/jingying-cabin}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/cache/jingying-cabin-releases}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/jingying-cabin-current}"
ENV_FILE="${ENV_FILE:-/etc/jingying-cabin/production.env}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
BRANCH="${BRANCH:-codex/full-project-ui}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PM2_NAME="${PM2_NAME:-jingying-cabin}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
POSTGREST_READY_URL="${POSTGREST_READY_URL:-}"

BOOTSTRAP_SENTINEL="__atomic_release_bootstrap_v1__"
BOOTSTRAP_VERSION="bootstrap-v1"
MIGRATION_LOCK_KEY="jingying-cabin:deploy-migrations:v1"

TARGET_SHA=""
release_dir=""
previous_target=""
previous_sha=""
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
declare -A SUPABASE_LEDGER_VERSIONS=()
declare -A CUSTOM_LEDGER_FILES=()
LOCK_FD=""

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
  local saved_db="$DB_CONTAINER" saved_pm2="$PM2_NAME"

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
  DB_CONTAINER="$saved_db"
  PM2_NAME="$saved_pm2"
  export ENV_FILE
  POSTGREST_READY_URL="${POSTGREST_READY_URL:-}"
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
  local node_major pnpm_version
  for command_name in realpath stat id node pnpm pm2 curl timeout flock; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
  done
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$node_major" == "20" ]] || die "Node major must be 20 (found $(node --version))"
  pnpm_version="$(pnpm --version)"
  [[ "$pnpm_version" == "10.12.1" ]] || die "pnpm must be exactly 10.12.1 (found $pnpm_version)"
}

validate_runtime() {
  validate_rollback_runtime
  for command_name in git corepack docker find sort; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
  done
}

acquire_deploy_lock() {
  local lock_file="$RELEASE_ROOT/.deploy.lock" path_identity fd_identity
  if [[ -e "$lock_file" || -L "$lock_file" ]]; then
    validate_owner_and_mode "deploy lock" "$lock_file" file
  else
    ( umask 077; : > "$lock_file" ) || die "cannot create deploy lock: $lock_file"
    validate_owner_and_mode "deploy lock" "$lock_file" file
  fi
  exec {LOCK_FD}<>"$lock_file" || die "cannot open deploy lock: $lock_file"
  path_identity="$(stat -Lc '%d:%i' -- "$lock_file")"
  fd_identity="$(stat -Lc '%d:%i' -- "/proc/$$/fd/$LOCK_FD")" ||
    die "cannot verify physical deploy lock descriptor"
  [[ "$path_identity" == "$fd_identity" ]] || die "deploy lock path changed while opening"
  flock -n "$LOCK_FD" || die "another deployment already holds $lock_file"
}

validate_source_repo() {
  local git_root
  [[ -d "$SOURCE_REPO/.git" || -f "$SOURCE_REPO/.git" ]] ||
    die "SOURCE_REPO is not a Git worktree: $SOURCE_REPO"
  git_root="$(git -C "$SOURCE_REPO" rev-parse --show-toplevel)"
  git_root="$(physical_path "$git_root")"
  [[ "$git_root" == "$SOURCE_REPO" ]] || die "SOURCE_REPO must be the physical repository root: $git_root"
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
  local target="$1" sha="$2"
  validate_release_path "$target"
  [[ "$(basename "$target")" == "$sha" ]] || die "release SHA/path mismatch: $target"
  [[ -f "$target/ecosystem.config.cjs" ]] || die "release lacks ecosystem config: $target"
  [[ -x "$target/scripts/verify-release.sh" ]] || die "release lacks executable verifier: $target"
  [[ -f "$target/app/api/health/route.ts" ]] || die "release lacks health source: $target"
  grep -Fq 'process.env.RELEASE_SHA' "$target/app/api/health/route.ts" ||
    die "release health route lacks full RELEASE_SHA capability: $target"
}

load_previous_release() {
  [[ -L "$CURRENT_LINK" ]] ||
    die "CURRENT_LINK is not a managed release symlink; follow docs/runbooks/atomic-release-bootstrap.md"
  previous_target="$(physical_path "$CURRENT_LINK")"
  [[ -d "$previous_target" ]] || die "CURRENT_LINK target does not exist: $previous_target"
  previous_sha="$(basename "$previous_target")"
  validate_release_capabilities "$previous_target" "$previous_sha"
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
  local candidate="$1" pm2_snapshot
  pm2_snapshot="$(pm2 jlist)" || return 0
  PM2_CANDIDATE="$candidate" node -e '
    const fs = require("node:fs");
    const candidate = fs.realpathSync(process.env.PM2_CANDIDATE);
    const entries = JSON.parse(fs.readFileSync(0, "utf8"));
    const referenced = entries.some(({ pm2_env: env = {} }) => {
      if (typeof env.pm_cwd !== "string") return false;
      try { return fs.realpathSync(env.pm_cwd) === candidate; } catch { return true; }
    });
    process.exit(referenced ? 0 : 1);
  ' <<< "$pm2_snapshot"
}

db() {
  docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

db_q() {
  db -Atqc "$1"
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
  local file="$1" base version
  base="$(basename "$file")"
  [[ "$base" =~ ^([0-9]{14})_([0-9A-Za-z_.-]+)\.sql$ ]] ||
    die "migration filename must begin with an exact 14-digit version: $base"
  version="${BASH_REMATCH[1]}"
  [[ -z "${MIGRATION_VERSIONS[$version]:-}" ]] ||
    die "duplicate migration version $version: $base and ${MIGRATION_VERSIONS[$version]}"
  MIGRATION_VERSIONS[$version]="$base"
}

validate_expand_header() {
  local file="$1"
  node "$DEPLOY_SCRIPT_DIR/validate-expand-migration.mjs" "$file" ||
    die "expand migration validation failed: $(basename "$file")"
}

preflight_migration_ledgers() {
  local file base version supabase_present custom_present sentinel_present
  local version_column supabase_applied custom_filename custom_version
  local supabase_rows custom_rows row_filename row_version
  PENDING_MIGRATIONS=()
  BOOTSTRAP_FILENAMES=()
  MIGRATION_VERSIONS=()
  SUPABASE_LEDGER_VERSIONS=()
  CUSTOM_LEDGER_FILES=()

  docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "database container was not found: $DB_CONTAINER"
  supabase_present="$(db_q "select to_regclass('supabase_migrations.schema_migrations') is not null")"
  [[ "$supabase_present" == "t" ]] ||
    die "no trusted Supabase migration ledger; follow docs/runbooks/atomic-release-bootstrap.md"
  custom_present="$(db_q "select to_regclass('public.deploy_migrations') is not null")"

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
    version_column="$(db_q "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='deploy_migrations' and column_name='version')")"
    [[ "$version_column" == "t" ]] ||
      die "legacy deploy ledger lacks version mapping; follow docs/runbooks/atomic-release-bootstrap.md"
    sentinel_present="$(db_q "select exists(select 1 from public.deploy_migrations where filename='$BOOTSTRAP_SENTINEL' and version='$BOOTSTRAP_VERSION')")"
    [[ "$sentinel_present" == "t" ]] ||
      die "deploy ledger lacks trusted bootstrap sentinel; follow docs/runbooks/atomic-release-bootstrap.md"
    custom_ledger_state="trusted"
    custom_rows="$(db_q "select filename || E'\\t' || version from public.deploy_migrations order by version, filename")" ||
      die "cannot read custom migration ledger"
    while IFS=$'\t' read -r row_filename row_version; do
      [[ -z "$row_filename" ]] && continue
      if [[ "$row_filename" == "$BOOTSTRAP_SENTINEL" && "$row_version" == "$BOOTSTRAP_VERSION" ]]; then
        continue
      fi
      [[ "$row_filename" =~ ^([0-9]{14})_([0-9A-Za-z_.-]+)\.sql$ ]] ||
        die "invalid filename in custom migration ledger: $row_filename"
      [[ "${BASH_REMATCH[1]}" == "$row_version" ]] ||
        die "custom ledger version/filename mismatch: $row_filename / $row_version"
      [[ "${MIGRATION_VERSIONS[$row_version]:-}" == "$row_filename" ]] ||
        die "custom ledger row has no exact candidate mapping: $row_filename"
      [[ -n "${SUPABASE_LEDGER_VERSIONS[$row_version]:-}" ]] ||
        die "custom ledger row is absent from Supabase ledger: $row_filename"
      [[ -z "${CUSTOM_LEDGER_FILES[$row_version]:-}" ]] ||
        die "duplicate custom ledger version: $row_version"
      CUSTOM_LEDGER_FILES[$row_version]="$row_filename"
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
      custom_version="f"
      [[ "$custom_filename" == "$base" ]] && custom_version="t"
      [[ "$supabase_applied" == "$custom_version" ]] ||
        die "migration ledger mismatch for version $version: supabase=$supabase_applied custom=$custom_filename"
    else
      custom_version="$supabase_applied"
      [[ "$supabase_applied" == "t" ]] && BOOTSTRAP_FILENAMES+=("$base")
    fi
    if [[ "$supabase_applied" != "t" ]]; then
      PENDING_MIGRATIONS+=("$file")
    fi
  done < "$migration_manifest"

  for file in "${PENDING_MIGRATIONS[@]}"; do
    validate_expand_header "$file"
  done
  if (( ${#PENDING_MIGRATIONS[@]} > 0 )); then
    [[ "$POSTGREST_READY_URL" =~ ^https?:// ]] ||
      die "POSTGREST_READY_URL is required before applying migrations"
  fi
}

bootstrap_custom_ledger() {
  local base version
  [[ "$custom_ledger_state" == "absent" ]] || return 0
  {
    printf 'begin;\n'
    printf "select pg_advisory_xact_lock(hashtextextended('%s', 0));\n" "$MIGRATION_LOCK_KEY"
    cat <<'SQL'
create table public.deploy_migrations (
  filename text primary key,
  version text not null unique,
  applied_at timestamptz not null default now()
);
SQL
    for base in "${BOOTSTRAP_FILENAMES[@]}"; do
      version="${base%%_*}"
      printf "insert into public.deploy_migrations(filename, version) values ('%s', '%s');\n" "$base" "$version"
    done
    printf "insert into public.deploy_migrations(filename, version) values ('%s', '%s');\n" \
      "$BOOTSTRAP_SENTINEL" "$BOOTSTRAP_VERSION"
    printf 'commit;\n'
  } | db -q
  custom_ledger_state="trusted"
}

apply_one_migration() {
  local file="$1" base version name output
  base="$(basename "$file")"
  version="${base%%_*}"
  name="${base#*_}"
  name="${name%.sql}"
  output="$({
    printf 'begin;\n'
    printf "select pg_advisory_xact_lock(hashtextextended('%s', 0));\n" "$MIGRATION_LOCK_KEY"
    printf "do \\\$\\\$ declare c boolean; s boolean; begin select exists(select 1 from public.deploy_migrations where filename='%s' and version='%s') into c; select exists(select 1 from supabase_migrations.schema_migrations where version='%s') into s; if c <> s then raise exception 'migration ledger mismatch under lock for version %s'; end if; end \\\$\\\$;\n" \
      "$base" "$version" "$version" "$version"
    printf "select not exists(select 1 from public.deploy_migrations where filename='%s' and version='%s') as should_apply \\gset\n" "$base" "$version"
    printf '\\if :should_apply\n'
    cat "$file"
    printf "\ninsert into public.deploy_migrations(filename, version) values ('%s', '%s');\n" "$base" "$version"
    printf "insert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s') on conflict (version) do nothing;\n" "$version" "$name"
    printf "select 'APPLIED:%s';\n" "$base"
    printf '\\else\n'
    printf "select 'SKIPPED:%s';\n" "$base"
    printf '\\endif\ncommit;\n'
  } | db -Atq)" || die "migration transaction failed: $base"
  printf '%s\n' "$output"
}

wait_for_postgrest_schema_cache() {
  timeout --signal=TERM 30s curl --fail --silent --show-error \
    --connect-timeout 2 --max-time 5 --retry 5 --retry-delay 1 \
    --retry-all-errors --retry-max-time 25 "$POSTGREST_READY_URL" >/dev/null
}

apply_migrations() {
  local file output applied=0
  bootstrap_custom_ledger
  for file in "${PENDING_MIGRATIONS[@]}"; do
    log "Applying expand migration $(basename "$file")"
    output="$(apply_one_migration "$file")"
    [[ "$output" == *"APPLIED:"* ]] && applied=$((applied + 1))
  done
  if (( applied > 0 )); then
    db_q "select pg_notify('pgrst', 'reload schema')" >/dev/null ||
      die "PostgREST schema reload notification failed"
    wait_for_postgrest_schema_cache ||
      die "PostgREST schema cache readiness did not recover within 30 seconds"
  fi
  log "Migrations complete ($applied newly applied)"
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
  validate_release_capabilities "$previous_target" "$previous_sha"
  if [[ -e "$rollback_link" || -L "$rollback_link" ]]; then
    [[ -L "$rollback_link" ]] || die "rollback temporary path is not a symlink: $rollback_link"
    rm -- "$rollback_link"
  fi
  ln -sfn "$previous_target" "$rollback_link"
  mv -Tf "$rollback_link" "$CURRENT_LINK"
  current_switched=0
}

reload_pm2() {
  local sha="$1"
  CURRENT_LINK="$CURRENT_LINK" PM2_NAME="$PM2_NAME" RELEASE_SHA="$sha" \
    pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
}

save_pm2() {
  pm2 save
}

verify_release() {
  local sha="$1"
  CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" PM2_NAME="$PM2_NAME" \
    HEALTH_URL="$HEALTH_URL" "$CURRENT_LINK/scripts/verify-release.sh" "$sha"
}

rollback_after_activation_failure() {
  # Application rollback does not roll back already committed expand migrations.
  warn "Restoring previous application release; committed expand migrations remain"
  if ! rollback_current; then
    warn "Rollback symlink failed; preserving both releases for recovery"
    return 1
  fi
  if ! reload_pm2 "$previous_sha"; then
    warn "Previous PM2 reload failed; preserving both releases for recovery"
    return 1
  fi
  if ! verify_release "$previous_sha"; then
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
  validate_runtime
  validate_secure_env_file
  load_runtime_env
  validate_control_paths
  acquire_deploy_lock
  validate_source_repo
  load_previous_release

  git -C "$SOURCE_REPO" fetch origin "$BRANCH"
  TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")"
  TARGET_SHA="${TARGET_SHA,,}"
  [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "target is not a full Git SHA: $TARGET_SHA"
  release_dir="$RELEASE_ROOT/$TARGET_SHA"
  validate_release_path "$release_dir"
  [[ "$release_dir" != "$previous_target" ]] || die "target release is already current: $TARGET_SHA"

  [[ ! -e "$release_dir" ]] ||
    die "target release directory already exists; verify PM2 references and remove it manually: $release_dir"

  candidate_cleanup_intended=1
  log "Creating immutable candidate $TARGET_SHA"
  git -C "$SOURCE_REPO" worktree add --detach "$release_dir" "$TARGET_SHA"

  (
    cd "$release_dir"
    pnpm install --frozen-lockfile
    log "Building candidate before any database or service mutation"
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}" \
      RELEASE_SHA="$TARGET_SHA" pnpm run build
  ) 2>&1 | tee "$RELEASE_ROOT/$TARGET_SHA-build.log"

  migration_manifest="$(mktemp "$RELEASE_ROOT/.migrations.$TARGET_SHA.XXXXXX")"
  write_migration_manifest "$release_dir/supabase/migrations" "$migration_manifest"
  preflight_migration_ledgers
  apply_migrations

  log "Atomically switching current release to $TARGET_SHA"
  atomic_switch_current
  candidate_activation_attempted=1
  candidate_pm2_may_be_active=1
  if ! reload_pm2 "$TARGET_SHA" || ! verify_release "$TARGET_SHA" || ! save_pm2; then
    if rollback_after_activation_failure; then
      safe_remove_release_dir "$release_dir" || warn "rolled-back candidate was preserved"
      candidate_cleanup_intended=0
    else
      candidate_cleanup_intended=0
    fi
    die "new application release failed activation and was not persisted"
  fi

  candidate_pm2_may_be_active=0
  current_switched=0
  candidate_cleanup_intended=0
  cleanup_old_releases
  log "Deployment verified and persisted at $TARGET_SHA"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
