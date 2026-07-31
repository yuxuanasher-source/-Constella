# Atomic Release Bootstrap Runbook

This is the one-time, maintenance-window procedure that establishes the first
managed release. Normal releases must use `scripts/deploy.sh`; do not repeat
these bootstrap commands during routine deploys.

## 1. Merge prerequisites

The bootstrap `TARGET_SHA` must contain only the atomic deployment
infrastructure:

- the atomic deploy, verifier, ecosystem config, health full-SHA response, and
  this runbook;
- it must not contain any migration that is absent from the native
  `supabase_migrations.schema_migrations` ledger.

After this bootstrap release is verified and persisted, merge the OCR quota and
knowledge-share branches into a later, different `TARGET_SHA`. Their migration
owners must add the strict first-line `-- deploy: expand` marker. Release that
later SHA only through `scripts/deploy.sh`, so migrations run before its symlink
switch. Do not add those markers in the atomic-deploy branch.

## 2. Create protected paths and runtime env

Run as the deployment user, using root only for ownership setup:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 \
  /var/cache/jingying-cabin-releases
sudo install -d -o root -g "$(id -gn)" -m 0750 /etc/jingying-cabin
sudo install -o root -g "$(id -gn)" -m 0640 /dev/null \
  /etc/jingying-cabin/production.env
sudoedit /etc/jingying-cabin/production.env
```

The env file contains application runtime values and a PostgREST admin readiness
URL reachable from the host, for example:

```bash
POSTGREST_READY_URL=http://127.0.0.1:3001/ready
```

Neither the env file nor any parent deployment path may be group/world writable.

## 3. Audit migration ledgers read-only

Do not create or alter a ledger until both queries succeed:

```bash
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
docker inspect "$DB_CONTAINER"
docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
select version, name
from supabase_migrations.schema_migrations
order by version;

select to_regclass('public.deploy_migrations') as custom_ledger;
SQL
```

If `supabase_migrations.schema_migrations` is absent, stop. There is no trusted
ledger and deployment must remain fail-closed.

For a legacy `public.deploy_migrations`, first compare every 14-digit filename
prefix with the exact Supabase `version`. Resolve any mismatch from database
backup and release evidence; never infer applied state from table existence.
Only after an exact match, promote the legacy ledger in one transaction:

```bash
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
docker inspect "$DB_CONTAINER"
docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('jingying-cabin:deploy-migrations:v1', 0));
alter table public.deploy_migrations add column if not exists version text;
update public.deploy_migrations
set version = substring(filename from '^([0-9]{14})_')
where version is null;
do $$
begin
  if exists (
    select 1
    from public.deploy_migrations d
    left join supabase_migrations.schema_migrations s on s.version = d.version
    where d.filename not like '\_\_%' escape '\' and
      (d.version is null or s.version is null)
  ) then
    raise exception 'legacy deploy ledger does not exactly match Supabase ledger';
  end if;
end $$;
alter table public.deploy_migrations alter column version set not null;
create unique index if not exists deploy_migrations_version_key
  on public.deploy_migrations(version);
insert into public.deploy_migrations(filename, version)
values ('__atomic_release_bootstrap_v1__', 'bootstrap-v1')
on conflict (filename) do nothing;
commit;
SQL
```

If the custom ledger is absent, leave it absent. The first normal deploy creates
and imports it from the trusted Supabase ledger in one advisory-locked transaction.

## 4. Prepare and prove the legacy restore command

This is the only release for which `scripts/deploy.sh` cannot restore a previous
managed release. Before building the candidate, create a protected,
operator-specific restore script:

```bash
export LEGACY_RESTORE_SCRIPT=/etc/jingying-cabin/restore-legacy.sh
sudoedit "$LEGACY_RESTORE_SCRIPT"
sudo chown root:"$(id -gn)" "$LEGACY_RESTORE_SCRIPT"
sudo chmod 0750 "$LEGACY_RESTORE_SCRIPT"
```

The script must use the legacy application's physical cwd/config, not
`CURRENT_LINK`. It must exit zero only after all legacy PM2 instances are online,
their cwd/script values match the recorded legacy release, and the production
health URL succeeds. Keep its exact contents and the pre-bootstrap `pm2 jlist`
snapshot as change evidence.

Run it once while the legacy service is still current, then persist that known
working process list:

```bash
umask 077
test -x "$LEGACY_RESTORE_SCRIPT"
"$LEGACY_RESTORE_SCRIPT"
pm2 jlist | node -e '
  const fs = require("node:fs");
  const entries = JSON.parse(fs.readFileSync(0, "utf8"));
  const redacted = entries.map(({ name, pm2_env: env = {} }) => ({
    name,
    status: env.status,
    pm_cwd: env.pm_cwd,
    pm_exec_path: env.pm_exec_path,
    args: env.args,
    release_sha: env.RELEASE_SHA ?? null,
  }));
  process.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`);
' > "/var/cache/jingying-cabin-releases/legacy-pm2-before-bootstrap.redacted.json"
pm2 save
```

Do not continue if this rehearsal changes the expected release, fails health, or
cannot reconstruct the legacy service without the source checkout being reset.
Never store raw `pm2 jlist` output as an artifact because it can contain runtime
secrets.

## 5. Build and prove the first managed release on staging

Use Node 20 and pnpm 10.12.1. Select the target only after its exact SHA has
passed hosted CI. Source the new deploy helpers so the bootstrap uses the same
runtime, ownership, physical-path, and host-lock checks as later releases:

```bash
set -Eeuo pipefail
export SOURCE_REPO=/var/www/jingying-cabin
export RELEASE_ROOT=/var/cache/jingying-cabin-releases
export CURRENT_LINK=/var/www/jingying-cabin-current
export ENV_FILE=/etc/jingying-cabin/production.env
export BRANCH=codex/full-project-ui
export DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
export LEGACY_RESTORE_SCRIPT=/etc/jingying-cabin/restore-legacy.sh
export STAGING_LINK=/var/www/jingying-cabin-bootstrap-staging
export STAGING_PM2_NAME=jingying-cabin-bootstrap-staging
export STAGING_PORT=3002

source "$SOURCE_REPO/scripts/deploy.sh"
validate_runtime
validate_secure_env_file
load_runtime_env
validate_control_paths
acquire_deploy_lock
validate_source_repo

git -C "$SOURCE_REPO" fetch origin "$BRANCH"
TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]
release_dir="$RELEASE_ROOT/$TARGET_SHA"
validate_release_path "$release_dir"
[[ ! -e "$release_dir" ]]
git -C "$SOURCE_REPO" worktree add --detach "$release_dir" "$TARGET_SHA"

(
  cd "$release_dir"
  pnpm install --frozen-lockfile
  RELEASE_SHA="$TARGET_SHA" pnpm run build
)

migration_manifest="$(mktemp "$RELEASE_ROOT/.bootstrap-migrations.XXXXXX")"
write_migration_manifest "$release_dir/supabase/migrations" "$migration_manifest"
preflight_migration_ledgers
(( ${#PENDING_MIGRATIONS[@]} == 0 )) || {
  printf 'Bootstrap target contains unapplied migrations; refusing switch.\n' >&2
  exit 1
}
```

The bootstrap must never call `apply_migrations`. A later, different release
applies the marked OCR and knowledge-share expand migrations through the normal
deployment entrypoint.

Use an isolated link, PM2 name, and port to prove the exact candidate without
touching production:

```bash
[[ ! -e "$STAGING_LINK" && ! -L "$STAGING_LINK" ]]
ln -s "$release_dir" "$STAGING_LINK"
CURRENT_LINK="$STAGING_LINK" PM2_NAME="$STAGING_PM2_NAME" \
  RELEASE_SHA="$TARGET_SHA" PORT="$STAGING_PORT" \
  pm2 startOrReload "$STAGING_LINK/ecosystem.config.cjs" --update-env
CURRENT_LINK="$STAGING_LINK" RELEASE_ROOT="$RELEASE_ROOT" \
  PM2_NAME="$STAGING_PM2_NAME" \
  HEALTH_URL="http://127.0.0.1:${STAGING_PORT}/api/health" \
  "$STAGING_LINK/scripts/verify-release.sh" "$TARGET_SHA"
```

If staging verification fails, delete only the staging PM2 process and symlink;
leave the candidate worktree for inspection. Do not touch the production PM2
process or create `CURRENT_LINK`.

```bash
pm2 delete "$STAGING_PM2_NAME"
rm -- "$STAGING_LINK"
```

## 6. Switch production with explicit first-release recovery

Run this block in the same shell so the deployment lock remains held. It
atomically creates `CURRENT_LINK`, activates the already-proven candidate, and
persists PM2 only after exact verification:

```bash
next_link="${CURRENT_LINK}.next"
[[ ! -e "$next_link" && ! -L "$next_link" ]]
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$CURRENT_LINK"

if ! CURRENT_LINK="$CURRENT_LINK" PM2_NAME=jingying-cabin \
    RELEASE_SHA="$TARGET_SHA" pm2 startOrReload \
    "$CURRENT_LINK/ecosystem.config.cjs" --update-env ||
  ! CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" \
    PM2_NAME=jingying-cabin \
    "$CURRENT_LINK/scripts/verify-release.sh" "$TARGET_SHA"; then
  printf 'Managed release activation failed; restoring rehearsed legacy service.\n' >&2
  if "$LEGACY_RESTORE_SCRIPT"; then
    failed_link="${CURRENT_LINK}.failed-${TARGET_SHA}"
    [[ ! -e "$failed_link" && ! -L "$failed_link" ]]
    mv -Tf "$CURRENT_LINK" "$failed_link"
    if pm2 delete "$STAGING_PM2_NAME"; then
      pm2 save
      printf 'Legacy service restored; candidate and failed link were preserved.\n' >&2
    else
      printf 'Legacy service restored, but staging cleanup failed; the pre-bootstrap PM2 dump remains authoritative.\n' >&2
    fi
  else
    printf 'CRITICAL: legacy restore failed; preserve all releases and PM2 evidence.\n' >&2
  fi
  exit 1
fi

pm2 delete "$STAGING_PM2_NAME"
rm -- "$STAGING_LINK"
pm2 save
```

Confirm the production health response, PM2 cwd/script, and `CURRENT_LINK` all
identify `TARGET_SHA` after `pm2 save`. Keep the legacy restore script, PM2
snapshot, old release, and candidate for the entire observation window.
Expand migrations are not application rollback.
