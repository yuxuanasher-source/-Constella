#!/usr/bin/env bash
#
# Atomic production deployment:
#   immutable candidate -> expand migrations -> symlink switch -> verification
#
# The current release must already be represented by CURRENT_LINK and live below
# RELEASE_ROOT. Bootstrap the first managed release in a maintenance window and
# verify it on a staging PM2 name before using this script for production updates.
#
# A failed health check rolls the application symlink and PM2 process back. It
# does not roll back or revert expand migrations that have already committed.
set -Eeuo pipefail

SOURCE_REPO="${SOURCE_REPO:-/var/www/jingying-cabin}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/cache/jingying-cabin-releases}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/jingying-cabin-current}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
BRANCH="${BRANCH:-codex/full-project-ui}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PM2_NAME="${PM2_NAME:-jingying-cabin}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
BASELINE_BEFORE="20260626"
# Every pending migration must opt in explicitly with a leading
# `-- deploy: expand` comment. `-- deploy: contract` is always refused.

TARGET_SHA=""
release_dir=""
previous_target=""
previous_sha=""
candidate_created=0
current_switched=0

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

require_absolute_path() {
  local name="$1" value="$2"
  [[ "$value" == /* ]] || die "$name must be an absolute path: $value"
}

normalize_path() {
  # Lexical normalization is deliberate: resolving CURRENT_LINK here would
  # replace the symlink path with its target and defeat atomic switching.
  realpath -ms -- "$1"
}

reject_dangerous_path() {
  local name="$1" value
  value="$(normalize_path "$2")"
  case "$value" in
    "/"|"/var"|"/var/cache"|"$HOME")
      die "$name is a protected path: $value"
      ;;
  esac
}

path_is_within() {
  local child parent
  child="$(normalize_path "$1")"
  parent="$(normalize_path "$2")"
  [[ "$child" == "$parent"/* ]]
}

validate_paths() {
  for entry in SOURCE_REPO RELEASE_ROOT CURRENT_LINK; do
    require_absolute_path "$entry" "${!entry}"
    reject_dangerous_path "$entry" "${!entry}"
  done

  SOURCE_REPO="$(normalize_path "$SOURCE_REPO")"
  RELEASE_ROOT="$(normalize_path "$RELEASE_ROOT")"
  CURRENT_LINK="$(normalize_path "$CURRENT_LINK")"

  [[ -d "$SOURCE_REPO/.git" || -f "$SOURCE_REPO/.git" ]] ||
    die "SOURCE_REPO is not a Git worktree: $SOURCE_REPO"
  [[ ! -L "$SOURCE_REPO" ]] || die "SOURCE_REPO must not be a symlink"
  [[ ! -L "$RELEASE_ROOT" ]] || die "RELEASE_ROOT must not be a symlink"
  [[ -z "$(git -C "$SOURCE_REPO" rev-parse --show-prefix)" ]] ||
    die "SOURCE_REPO must be the repository root"

  [[ "$RELEASE_ROOT" != "$SOURCE_REPO" ]] ||
    die "RELEASE_ROOT must not equal SOURCE_REPO"
  ! path_is_within "$RELEASE_ROOT" "$SOURCE_REPO" ||
    die "RELEASE_ROOT must not be inside SOURCE_REPO"
  ! path_is_within "$SOURCE_REPO" "$RELEASE_ROOT" ||
    die "RELEASE_ROOT must not contain SOURCE_REPO"
  [[ "$CURRENT_LINK" != "$SOURCE_REPO" && "$CURRENT_LINK" != "$RELEASE_ROOT" ]] ||
    die "CURRENT_LINK must not equal a repository or release root"
  ! path_is_within "$CURRENT_LINK" "$RELEASE_ROOT" ||
    die "CURRENT_LINK must be outside RELEASE_ROOT"

  [[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] ||
    die "KEEP_RELEASES must be a positive integer"
}

validate_runtime() {
  local node_major pnpm_version
  for command_name in git realpath node pnpm corepack docker pm2 curl; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "required command is missing: $command_name"
  done
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$node_major" == "20" ]] || die "Node major must be 20 (found $(node --version))"
  pnpm_version="$(pnpm --version)"
  [[ "$pnpm_version" == "10.12.1" ]] ||
    die "pnpm must be exactly 10.12.1 (found $pnpm_version)"
}

validate_release_path() {
  local candidate="$1" normalized parent name
  require_absolute_path "release path" "$candidate"
  normalized="$(normalize_path "$candidate")"
  parent="$(dirname "$normalized")"
  name="$(basename "$normalized")"
  [[ "$parent" == "$RELEASE_ROOT" ]] ||
    die "release path escapes RELEASE_ROOT: $normalized"
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] ||
    die "release directory must use a full lowercase Git SHA: $normalized"
  [[ ! -L "$candidate" ]] || die "release directory must not be a symlink: $candidate"
}

safe_remove_release_dir() {
  local candidate="$1" current=""
  validate_release_path "$candidate"
  if [[ -L "$CURRENT_LINK" ]]; then
    current="$(readlink -f "$CURRENT_LINK" || true)"
  fi
  [[ "$candidate" != "$current" && "$candidate" != "$previous_target" ]] ||
    die "refusing to remove a protected release: $candidate"
  [[ -e "$candidate" ]] || return 0
  git -C "$SOURCE_REPO" worktree remove --force "$candidate" >/dev/null 2>&1 || true
  if [[ -e "$candidate" ]]; then
    rm -rf --one-file-system -- "$candidate"
  fi
  git -C "$SOURCE_REPO" worktree prune >/dev/null 2>&1 || true
}

load_previous_release() {
  [[ -L "$CURRENT_LINK" ]] ||
    die "CURRENT_LINK must already be a symlink to a managed release; bootstrap during maintenance first"
  previous_target="$(normalize_path "$(readlink -f "$CURRENT_LINK")")"
  [[ -d "$previous_target" ]] || die "CURRENT_LINK target does not exist: $previous_target"
  validate_release_path "$previous_target"
  previous_sha="$(basename "$previous_target")"
}

db() {
  docker exec -i "$DB_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

db_q() {
  db -tAc "$1"
}

assert_expand_migration() {
  local file="$1" base
  base="$(basename "$file")"
  if grep -Eiq '^--[[:space:]]*deploy:[[:space:]]*contract([[:space:]]|$)' "$file"; then
    die "contract migration requires a later, separately coordinated release: $base"
  fi
  if ! grep -Eiq '^--[[:space:]]*deploy:[[:space:]]*expand([[:space:]]|$)' "$file"; then
    die "pending migration must declare -- deploy: expand after review: $base"
  fi
}

apply_migrations() {
  local migrations_dir="$1" applied=0 base file count
  [[ -d "$migrations_dir" ]] || die "migration directory is missing: $migrations_dir"
  docker inspect "$DB_CONTAINER" >/dev/null 2>&1 ||
    die "database container was not found: $DB_CONTAINER"

  log "Ensuring deploy_migrations ledger exists"
  db -q <<'SQL'
create table if not exists public.deploy_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
SQL

  count="$(db_q 'select count(*) from public.deploy_migrations')"
  if [[ "$count" == "0" ]]; then
    log "Bootstrapping the historical migration ledger"
    while IFS= read -r -d '' file; do
      base="$(basename "$file")"
      [[ "$base" =~ ^[0-9A-Za-z_.-]+$ ]] || die "unsafe migration filename: $base"
      if [[ "$base" < "$BASELINE_BEFORE" ]]; then
        db_q "insert into public.deploy_migrations(filename) values ('$base') on conflict do nothing" >/dev/null
      fi
    done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print0 | sort -z)
    if [[ -n "$(db_q "select to_regclass('public.ai_drafts')")" ]]; then
      db_q "insert into public.deploy_migrations(filename) values ('20260626100000_ai_safety_foundation.sql') on conflict do nothing" >/dev/null
    fi
    if [[ -n "$(db_q "select to_regclass('public.knowledge_documents')")" ]]; then
      db_q "insert into public.deploy_migrations(filename) values ('20260626110000_ai_knowledge_base.sql') on conflict do nothing" >/dev/null
    fi
  fi

  log "Applying database migrations from immutable candidate"
  while IFS= read -r -d '' file; do
    base="$(basename "$file")"
    [[ "$base" =~ ^[0-9A-Za-z_.-]+$ ]] || die "unsafe migration filename: $base"
    [[ -z "$(db_q "select 1 from public.deploy_migrations where filename = '$base'")" ]] || continue
    assert_expand_migration "$file"
    log "  -> $base"
    # Migration and ledger update commit together in one database transaction.
    {
      cat "$file"
      printf "\ninsert into public.deploy_migrations(filename) values ('%s') on conflict do nothing;\n" "$base"
    } | db --single-transaction
    applied=$((applied + 1))
  done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print0 | sort -z)

  if [[ "$applied" -gt 0 ]]; then
    db_q "notify pgrst, 'reload schema'" >/dev/null ||
      warn "PostgREST schema reload notification failed; manual reload is required"
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
  [[ -n "$previous_target" && -n "$previous_sha" ]] ||
    die "no validated previous release is available for rollback"
  validate_release_path "$previous_target"
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

verify_release() {
  local sha="$1"
  CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" PM2_NAME="$PM2_NAME" \
    HEALTH_URL="$HEALTH_URL" "$CURRENT_LINK/scripts/verify-release.sh" "$sha"
}

cleanup_old_releases() {
  local seen=0 entry path current
  current="$(normalize_path "$(readlink -f "$CURRENT_LINK")")"
  while IFS= read -r entry; do
    path="${entry#* }"
    validate_release_path "$path"
    seen=$((seen + 1))
    if [[ "$path" == "$current" || "$path" == "$previous_target" ]]; then
      continue
    fi
    if [[ "$seen" -le "$KEEP_RELEASES" ]]; then
      continue
    fi
    safe_remove_release_dir "$path"
  done < <(find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d \
    -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\n' | sort -nr)
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    set +e
    if [[ "$current_switched" -eq 1 && -n "$previous_target" ]]; then
      warn "Unexpected failure after switch; restoring the previous application release"
      rollback_current
      reload_pm2 "$previous_sha"
      verify_release "$previous_sha" ||
        warn "The previous symlink was restored but release verification failed"
    fi
    if [[ "$candidate_created" -eq 1 && -n "$release_dir" ]]; then
      safe_remove_release_dir "$release_dir"
    fi
    warn "Deployment failed. Already committed expand migrations are not rolled back."
  fi
  exit "$status"
}

main() {
  trap on_exit EXIT
  validate_runtime
  validate_paths
  load_previous_release

  mkdir -p -- "$RELEASE_ROOT" "$RELEASE_ROOT/logs"
  git -C "$SOURCE_REPO" fetch origin "$BRANCH"
  TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")"
  TARGET_SHA="${TARGET_SHA,,}"
  [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "target is not a full Git SHA: $TARGET_SHA"
  release_dir="$RELEASE_ROOT/$TARGET_SHA"
  validate_release_path "$release_dir"
  [[ "$release_dir" != "$previous_target" ]] || die "target release is already current: $TARGET_SHA"

  if [[ -e "$release_dir" ]]; then
    safe_remove_release_dir "$release_dir"
  fi

  log "Creating immutable candidate $TARGET_SHA"
  git -C "$SOURCE_REPO" worktree add --detach "$release_dir" "$TARGET_SHA"
  candidate_created=1

  (
    cd "$release_dir"
    pnpm install --frozen-lockfile
    log "Building candidate before any database or service mutation"
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}" \
      RELEASE_SHA="$TARGET_SHA" pnpm run build
  ) 2>&1 | tee "$RELEASE_ROOT/logs/$TARGET_SHA-build.log"

  # This invocation intentionally occurs only after the candidate build above.
  apply_migrations "$release_dir/supabase/migrations"

  log "Atomically switching current release to $TARGET_SHA"
  atomic_switch_current
  reload_pm2 "$TARGET_SHA"

  if ! verify_release "$TARGET_SHA"; then
    warn "New release verification failed; rolling the application back"
    rollback_current
    reload_pm2 "$previous_sha"
    verify_release "$previous_sha" ||
      die "previous release was restored but failed verification"
    safe_remove_release_dir "$release_dir"
    candidate_created=0
    die "application rolled back; committed expand migrations were not rolled back"
  fi

  # From this point on, cleanup failure must never roll back a verified release.
  current_switched=0
  candidate_created=0
  cleanup_old_releases
  log "Deployment verified at $TARGET_SHA"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
