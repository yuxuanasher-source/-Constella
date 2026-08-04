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
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 \
  /var/cache/jingying-cabin-release-artifacts
sudo install -d -o root -g "$(id -gn)" -m 0750 \
  /var/lock/jingying-cabin
sudo install -o "$(id -un)" -g "$(id -gn)" -m 0600 /dev/null \
  /var/lock/jingying-cabin/deploy.lock
sudo install -d -o root -g "$(id -gn)" -m 0750 /etc/jingying-cabin
sudo install -d -o root -g "$(id -gn)" -m 0750 \
  /etc/jingying-cabin/release-controls
sudo install -o root -g "$(id -gn)" -m 0640 /dev/null \
  /etc/jingying-cabin/production.env
sudoedit /etc/jingying-cabin/production.env
```

Enable the PostgREST admin server so only the deployment host can reach it. Its
`ready` endpoint proves the connection pool and schema cache are healthy; its
`metrics` endpoint gives the successful schema-cache load counter used to prove
that a post-migration generation is newer than the pre-migration generation.
The admin-only `schema_cache` endpoint must also expose the release-specific
probe view created in the serialized migration transaction. All three signals
must agree; a counter increment from an unrelated reload is insufficient.

For a host-native PostgREST process, bind the admin server directly to loopback:

```bash
PGRST_ADMIN_SERVER_HOST=127.0.0.1
PGRST_ADMIN_SERVER_PORT=3001
```

For Docker, the process must listen on the container interface, while Docker
publishes that port on host loopback only:

```yaml
services:
  postgrest:
    environment:
      PGRST_ADMIN_SERVER_HOST: "0.0.0.0"
      PGRST_ADMIN_SERVER_PORT: "3001"
    ports:
      - "127.0.0.1:3001:3001"
```

Do not use a public host binding, host networking, or the public reverse proxy
for this admin port. Restart PostgREST after this non-reloadable setting changes,
then prove host access before the maintenance window:

```bash
curl --fail --silent --show-error http://127.0.0.1:3001/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3001/metrics |
  grep 'pgrst_schema_cache_loads_total{status="SUCCESS"}'
curl --fail --silent --show-error http://127.0.0.1:3001/schema_cache |
  node -e 'JSON.parse(require("node:fs").readFileSync(0, "utf8"))'
```

The protected application env file contains the three loopback URLs:

```bash
POSTGREST_READY_URL=http://127.0.0.1:3001/ready
POSTGREST_METRICS_URL=http://127.0.0.1:3001/metrics
POSTGREST_SCHEMA_CACHE_URL=http://127.0.0.1:3001/schema_cache
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

select
  to_regclass('public.deploy_migrations') as unsafe_legacy_ledger,
  to_regclass('deploy_internal.schema_migrations') as private_deploy_ledger;
SQL
```

If `supabase_migrations.schema_migrations` is absent, stop. There is no trusted
ledger and deployment must remain fail-closed.

For a legacy `public.deploy_migrations`, build the expected ledger from an
isolated export of the reviewed commit, including migration SHA-256 content
hashes. Do not rely on whatever branch happens to be checked out:

```bash
TARGET_SHA=<reviewed-full-40-character-ci-sha>
SOURCE_REPO=/var/www/jingying-cabin
BRANCH=codex/full-project-ui
AUDIT_ROOT="/var/cache/jingying-cabin-bootstrap-audit-$TARGET_SHA"
[[ ! -e "$AUDIT_ROOT" ]]
install -d -m 0750 "$AUDIT_ROOT"
git -C "$SOURCE_REPO" fetch origin "$BRANCH"
[[ "$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")" == "$TARGET_SHA" ]]
git -C "$SOURCE_REPO" archive "$TARGET_SHA" supabase/migrations |
  tar -x -C "$AUDIT_ROOT"
CANDIDATE_MIGRATIONS="$AUDIT_ROOT/supabase/migrations"
EXPECTED_ROWS="$(
  find "$CANDIDATE_MIGRATIONS" -mindepth 1 -maxdepth 1 -type f -name '*.sql' \
    -print0 |
    sort -z |
    while IFS= read -r -d '' file; do
      base="$(basename "$file")"
      [[ "$base" =~ ^([0-9]{14})_[0-9A-Za-z_.-]+\.sql$ ]] || exit 1
      version="${BASH_REMATCH[1]}"
      content_sha256="$(sha256sum "$file" | awk '{print $1}')"
      [[ "$content_sha256" =~ ^[0-9a-f]{64}$ ]] || exit 1
      printf "('%s','%s','%s')," "$version" "$base" "$content_sha256"
    done
)"
EXPECTED_ROWS="${EXPECTED_ROWS%,}"
[[ -n "$EXPECTED_ROWS" ]]

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
docker inspect "$DB_CONTAINER"
docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
  -v "expected_rows=$EXPECTED_ROWS" -U postgres -d postgres <<'SQL'
begin;
select pg_advisory_xact_lock(hashtextextended('jingying-cabin:deploy-migrations:v1', 0));
create temporary table expected_bootstrap_migrations (
  version text primary key,
  filename text not null unique,
  content_sha256 text not null
) on commit drop;
insert into expected_bootstrap_migrations(version, filename, content_sha256)
values :expected_rows;
alter table public.deploy_migrations add column if not exists version text;
update public.deploy_migrations
set version = substring(filename from '^([0-9]{14})_')
where version is null;
do $$
begin
  if exists (
    select 1
    from public.deploy_migrations d
    left join expected_bootstrap_migrations e
      on e.version = d.version and e.filename = d.filename
    left join supabase_migrations.schema_migrations s on s.version = d.version
    where d.filename not like '\_\_%' escape '\'
      and (d.version is null or e.version is null or s.version is null)
  ) or exists (
    select 1
    from supabase_migrations.schema_migrations s
    left join expected_bootstrap_migrations e using (version)
    left join public.deploy_migrations d
      on d.version = e.version and d.filename = e.filename
    where e.version is null or d.version is null
  ) or exists (
    select 1
    from expected_bootstrap_migrations e
    left join supabase_migrations.schema_migrations s using (version)
    left join public.deploy_migrations d
      on d.version = e.version and d.filename = e.filename
    where s.version is null or d.version is null
  ) then
    raise exception 'candidate, legacy, and Supabase ledgers do not match exactly in both directions';
  end if;
end $$;
alter table public.deploy_migrations add column if not exists content_sha256 text;
update public.deploy_migrations d
set content_sha256 = e.content_sha256
from expected_bootstrap_migrations e
where e.version = d.version and e.filename = d.filename;
alter table public.deploy_migrations alter column version set not null;
alter table public.deploy_migrations alter column content_sha256 set not null;
alter table public.deploy_migrations
  add constraint deploy_migrations_content_sha256_check
  check (content_sha256 ~ '^[0-9a-f]{64}$');
create unique index if not exists deploy_migrations_version_key
  on public.deploy_migrations(version);
create schema if not exists deploy_internal authorization postgres;
revoke all on schema deploy_internal from public;
alter table public.deploy_migrations set schema deploy_internal;
alter table deploy_internal.deploy_migrations rename to schema_migrations;
alter table deploy_internal.schema_migrations owner to postgres;
revoke all on table deploy_internal.schema_migrations from public;
do $roles$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema deploy_internal from %I', role_name);
      execute format(
        'revoke all on table deploy_internal.schema_migrations from %I',
        role_name
      );
    end if;
  end loop;
end
$roles$;
alter table deploy_internal.schema_migrations enable row level security;
alter table deploy_internal.schema_migrations force row level security;
insert into deploy_internal.schema_migrations(filename, version, content_sha256)
values (
  '__atomic_release_bootstrap_v1__',
  'bootstrap-v1',
  '0000000000000000000000000000000000000000000000000000000000000000'
)
on conflict (filename) do nothing;
commit;
SQL
```

This bootstrap target must contain no pending migration, so the candidate,
Supabase, and legacy ledgers must match in both directions. Resolve any mismatch
from database backup and release evidence; never infer applied state from table
existence or filename alone. Preserve the isolated export with the change
evidence until the observation window ends.

If `deploy_internal.schema_migrations` already exists, stop unless it is owned by
`postgres`, is an ordinary table with both RLS and forced RLS enabled, has no
ACL entry for any non-owner, contains exactly one bootstrap sentinel, and every
non-sentinel row exactly matches both the candidate manifest and Supabase
ledger, including `content_sha256`. Never leave `public.deploy_migrations`
present.

If the custom ledger is absent, leave it absent. The first normal deploy creates
and imports it from the trusted Supabase ledger inside the same serialized
transaction as the migration batch.

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
timeout --signal=TERM --kill-after=5s 30s pm2 jlist | node -e '
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
timeout --signal=TERM --kill-after=5s 30s pm2 save
```

Do not continue if this rehearsal changes the expected release, fails health, or
cannot reconstruct the legacy service without the source checkout being reset.
Never store raw `pm2 jlist` output as an artifact because it can contain runtime
secrets.

## 5. Retrieve and prove the first managed release on staging

Select the target only after its exact SHA has passed hosted CI. Retrieve the
artifact by the reviewed workflow-run ID, not merely by branch or artifact
name. The run must report `success`, and its `headSha` must be `EXPECTED_SHA`.
Copy the resulting tar file into the protected artifact directory, mode `0600`,
and compare its SHA-256 with the digest printed in that same reviewed CI job
summary. The deployment host does not need GitHub credentials if a release
operator performs this retrieval and protected transfer.

One GitHub CLI retrieval pattern is:

```bash
set -Eeuo pipefail
export REPOSITORY=<owner/repository>
export CI_RUN_ID=<reviewed-successful-ci-run-id>
export EXPECTED_BRANCH=codex/full-project-ui
export EXPECTED_SHA=<reviewed-full-40-character-ci-sha>
export EXPECTED_RELEASE_MANIFEST_SHA256=<reviewed-ci-release-manifest-sha256>
export EXPECTED_RELEASE_ARTIFACT_SHA256=<reviewed-ci-release-artifact-sha256>
export ARTIFACT_DIR="/var/cache/jingying-cabin-release-artifacts/$EXPECTED_SHA"
[[ ! -e "$ARTIFACT_DIR" ]]
install -d -m 0750 "$ARTIFACT_DIR"
RUN_JSON="$(gh run view "$CI_RUN_ID" --repo "$REPOSITORY" \
  --json headBranch,headSha,event,conclusion)"
RUN_JSON="$RUN_JSON" EXPECTED_BRANCH="$EXPECTED_BRANCH" \
  EXPECTED_SHA="$EXPECTED_SHA" node -e '
  const run = JSON.parse(process.env.RUN_JSON);
  if (
    run.conclusion !== "success" ||
    run.event !== "push" ||
    run.headBranch !== process.env.EXPECTED_BRANCH ||
    run.headSha !== process.env.EXPECTED_SHA
  ) {
    process.exit(1);
  }
'
gh run download "$CI_RUN_ID" --repo "$REPOSITORY" \
  --name "release-runtime-$EXPECTED_SHA" --dir "$ARTIFACT_DIR"
export RELEASE_ARTIFACT_PATH="$ARTIFACT_DIR/release-runtime-$EXPECTED_SHA.tar"
chmod 0600 "$RELEASE_ARTIFACT_PATH"
printf '%s  %s\n' "$EXPECTED_RELEASE_ARTIFACT_SHA256" \
  "$RELEASE_ARTIFACT_PATH" | sha256sum --check --strict
```

Then use Node 20 and source the deploy helpers so bootstrap uses the same
runtime, ownership, physical-path, and host-lock checks as later releases:

```bash
set -Eeuo pipefail
export SOURCE_REPO=/var/www/jingying-cabin
export RELEASE_ROOT=/var/cache/jingying-cabin-releases
export CURRENT_LINK=/var/www/jingying-cabin-current
export ENV_FILE=/etc/jingying-cabin/production.env
export BRANCH=codex/full-project-ui
export EXPECTED_SHA=<reviewed-full-40-character-ci-sha>
export EXPECTED_RELEASE_MANIFEST_SHA256=<reviewed-ci-release-manifest-sha256>
export EXPECTED_RELEASE_ARTIFACT_SHA256=<reviewed-ci-release-artifact-sha256>
export RELEASE_ARTIFACT_PATH="/var/cache/jingying-cabin-release-artifacts/$EXPECTED_SHA/release-runtime-$EXPECTED_SHA.tar"
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
validate_release_artifact
acquire_deploy_lock
validate_source_repo

git -C "$SOURCE_REPO" fetch origin "$BRANCH"
TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$TARGET_SHA" == "$EXPECTED_SHA" ]] || {
  printf 'Reviewed SHA differs from remote branch head; refusing bootstrap.\n' >&2
  exit 1
}
release_dir="$RELEASE_ROOT/$TARGET_SHA"
validate_release_path "$release_dir"
[[ ! -e "$release_dir" ]]
git -C "$SOURCE_REPO" worktree add --detach "$release_dir" "$TARGET_SHA"
assert_release_git_state "$release_dir" "$TARGET_SHA"

node "$release_dir/scripts/extract-release-artifact.mjs" \
  "$RELEASE_ARTIFACT_PATH" "$release_dir" \
  "$EXPECTED_RELEASE_ARTIFACT_SHA256" "$TARGET_SHA"
assert_release_git_state "$release_dir" "$TARGET_SHA"
actual_manifest_sha256="$(
  sha256sum "$release_dir/.release-integrity.json" | awk '{print $1}'
)"
[[ "$actual_manifest_sha256" == "$EXPECTED_RELEASE_MANIFEST_SHA256" ]]
node "$release_dir/scripts/release-integrity.mjs" verify \
  "$release_dir" "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256"

# Establish root-owned, source-independent verification entrypoints. Future
# replacement requires another reviewed maintenance-window procedure.
sudo install -o root -g "$(id -gn)" -m 0640 \
  "$release_dir/scripts/release-integrity.mjs" \
  /etc/jingying-cabin/release-controls/release-integrity.mjs
sudo install -o root -g "$(id -gn)" -m 0640 \
  "$release_dir/scripts/deploy.sh" \
  /etc/jingying-cabin/release-controls/deploy.sh
sudo install -o root -g "$(id -gn)" -m 0640 \
  "$release_dir/scripts/verify-xingyao-hermes-rollback-package.mjs" \
  /etc/jingying-cabin/release-controls/verify-xingyao-hermes-rollback-package.mjs

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
  RELEASE_SHA="$TARGET_SHA" \
  RELEASE_MANIFEST_SHA256="$EXPECTED_RELEASE_MANIFEST_SHA256" \
  PORT="$STAGING_PORT" \
  pm2_bounded startOrReload "$STAGING_LINK/ecosystem.config.cjs" --update-env
CURRENT_LINK="$STAGING_LINK" RELEASE_ROOT="$RELEASE_ROOT" \
  PM2_NAME="$STAGING_PM2_NAME" \
  HEALTH_URL="http://127.0.0.1:${STAGING_PORT}/api/health" \
  "$STAGING_LINK/scripts/verify-release.sh" \
  "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256"
```

If staging verification fails, delete only the staging PM2 process and symlink;
leave the candidate worktree for inspection. Do not touch the production PM2
process or create `CURRENT_LINK`.

```bash
pm2_bounded delete "$STAGING_PM2_NAME"
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
    RELEASE_SHA="$TARGET_SHA" \
    RELEASE_MANIFEST_SHA256="$EXPECTED_RELEASE_MANIFEST_SHA256" \
    pm2_bounded startOrReload \
    "$CURRENT_LINK/ecosystem.config.cjs" --update-env ||
  ! CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" \
    PM2_NAME=jingying-cabin \
    "$CURRENT_LINK/scripts/verify-release.sh" \
      "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256" ||
  ! pm2_bounded save; then
  printf 'Managed release activation failed; restoring rehearsed legacy service.\n' >&2
  if "$LEGACY_RESTORE_SCRIPT"; then
    failed_link="${CURRENT_LINK}.failed-${TARGET_SHA}"
    [[ ! -e "$failed_link" && ! -L "$failed_link" ]]
    mv -Tf "$CURRENT_LINK" "$failed_link"
    if pm2_bounded save; then
      printf 'Legacy service restored; candidate and failed link were preserved.\n' >&2
    else
      printf 'CRITICAL: legacy service is healthy but its PM2 state could not be persisted.\n' >&2
    fi
  else
    printf 'CRITICAL: legacy restore failed; preserve all releases and PM2 evidence.\n' >&2
  fi
  exit 1
fi

# Production is already exactly verified and persisted. Staging cleanup is
# post-success housekeeping and must not turn a healthy production switch into
# an application rollback.
if pm2_bounded delete "$STAGING_PM2_NAME" &&
  rm -- "$STAGING_LINK" &&
  pm2_bounded save; then
  printf 'Staging process removed and persisted.\n'
else
  printf 'Production remains persisted; finish staging cleanup manually.\n' >&2
fi

CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" \
  PM2_NAME=jingying-cabin \
  "$CURRENT_LINK/scripts/verify-release.sh" \
  "$TARGET_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256"
```

Confirm the production health response, PM2 cwd/script, and `CURRENT_LINK` all
identify `TARGET_SHA` after `pm2 save`. Keep the legacy restore script, PM2
snapshot, old release, and candidate for the entire observation window.
Expand migrations are not application rollback.

## 7. Upgrade the protected control for telemetry rollout

The first release containing migration `20260803120500` requires a maintenance
window to replace the protected deploy control before the release deployment.
An older control cannot run the separately committed telemetry backfill. The
migration therefore fails closed, before migration ledger or application
activation changes, with:

```text
deploy_control_upgrade_required: install reviewed protected control before 20260803120500
```

Use the same reviewed successful CI run, SHA-named artifact, and hashes intended
for the release. Take `EXPECTED_DEPLOY_CONTROL_SHA256` from that run's `Deploy
control SHA-256` output. Take `TRUSTED_CURRENT_DEPLOY_CONTROL_SHA256` from the
off-host installation record for the currently protected control; never derive
the trusted value from the deployment host during the window.

Acquire and hash-check the release artifact as described in section 5. Then
stage a detached worktree for the exact reviewed commit. The source checkout is
used only to create that exact detached worktree; the already protected
integrity verifier must approve it before any protected file is replaced:

```bash
set -Eeuo pipefail
export SOURCE_REPO=/var/www/jingying-cabin
export RELEASE_ROOT=/var/cache/jingying-cabin-releases
export BRANCH=codex/full-project-ui
export EXPECTED_SHA=<reviewed-full-40-character-ci-sha>
export EXPECTED_RELEASE_MANIFEST_SHA256=<reviewed-ci-release-manifest-sha256>
export EXPECTED_RELEASE_ARTIFACT_SHA256=<reviewed-ci-release-artifact-sha256>
export EXPECTED_DEPLOY_CONTROL_SHA256=<reviewed-ci-deploy-control-sha256>
export TRUSTED_CURRENT_DEPLOY_CONTROL_SHA256=<off-host-current-control-sha256>
export RELEASE_ARTIFACT_PATH="/var/cache/jingying-cabin-release-artifacts/$EXPECTED_SHA/release-runtime-$EXPECTED_SHA.tar"
export TRUSTED_RELEASE_INTEGRITY=/etc/jingying-cabin/release-controls/release-integrity.mjs
export PROTECTED_DEPLOY_CONTROL=/etc/jingying-cabin/release-controls/deploy.sh
export PROTECTED_DEPLOY_CONTROL_NEXT=/etc/jingying-cabin/release-controls/deploy.sh.next
export CONTROL_BACKUP_DIR=/etc/jingying-cabin/release-controls/deploy-control-backups
export CONTROL_STAGE="$RELEASE_ROOT/$EXPECTED_SHA"

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$EXPECTED_RELEASE_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$EXPECTED_RELEASE_ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$EXPECTED_DEPLOY_CONTROL_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$TRUSTED_CURRENT_DEPLOY_CONTROL_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$(stat -Lc '%u:%a' "$PROTECTED_DEPLOY_CONTROL")" == "0:640" ]]
printf '%s  %s\n' "$TRUSTED_CURRENT_DEPLOY_CONTROL_SHA256" \
  "$PROTECTED_DEPLOY_CONTROL" | sha256sum --check --strict
printf '%s  %s\n' "$EXPECTED_RELEASE_ARTIFACT_SHA256" \
  "$RELEASE_ARTIFACT_PATH" | sha256sum --check --strict

git -C "$SOURCE_REPO" fetch origin "$BRANCH"
TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "origin/$BRANCH^{commit}")"
[[ "$TARGET_SHA" == "$EXPECTED_SHA" ]]
[[ ! -e "$CONTROL_STAGE" ]]
git -C "$SOURCE_REPO" worktree add --detach "$CONTROL_STAGE" "$EXPECTED_SHA"
[[ "$(git -C "$CONTROL_STAGE" rev-parse HEAD)" == "$EXPECTED_SHA" ]]
[[ -z "$(git -C "$CONTROL_STAGE" status --porcelain --untracked-files=no)" ]]
node "$CONTROL_STAGE/scripts/extract-release-artifact.mjs" \
  "$RELEASE_ARTIFACT_PATH" "$CONTROL_STAGE" \
  "$EXPECTED_RELEASE_ARTIFACT_SHA256" "$EXPECTED_SHA"
node "$TRUSTED_RELEASE_INTEGRITY" verify \
  "$CONTROL_STAGE" "$EXPECTED_SHA" "$EXPECTED_RELEASE_MANIFEST_SHA256"
printf '%s  %s\n' "$EXPECTED_DEPLOY_CONTROL_SHA256" \
  "$CONTROL_STAGE/scripts/deploy.sh" | sha256sum --check --strict
```

Back up the currently trusted file, install to a root-owned sibling, verify it,
and atomically rename it. The trap restores the reviewed old control if any
installation check or staging cleanup fails. It is disarmed before release
deployment because an old control must never be restored after the telemetry
migration may have started.

```bash
CONTROL_GROUP="$(stat -Lc '%G' "$PROTECTED_DEPLOY_CONTROL")"
CONTROL_BACKUP="$CONTROL_BACKUP_DIR/deploy.sh.$TRUSTED_CURRENT_DEPLOY_CONTROL_SHA256"
sudo install -d -o root -g "$CONTROL_GROUP" -m 0750 "$CONTROL_BACKUP_DIR"
sudo install -o root -g "$CONTROL_GROUP" -m 0640 \
  "$PROTECTED_DEPLOY_CONTROL" "$CONTROL_BACKUP"
printf '%s  %s\n' "$TRUSTED_CURRENT_DEPLOY_CONTROL_SHA256" \
  "$CONTROL_BACKUP" | sha256sum --check --strict

restore_protected_deploy_control() {
  sudo install -o root -g "$CONTROL_GROUP" -m 0640 \
    "$CONTROL_BACKUP" "$PROTECTED_DEPLOY_CONTROL"
  sudo rm -f -- "$PROTECTED_DEPLOY_CONTROL_NEXT"
}
trap restore_protected_deploy_control ERR INT TERM

sudo install -o root -g "$CONTROL_GROUP" -m 0640 \
  "$CONTROL_STAGE/scripts/deploy.sh" "$PROTECTED_DEPLOY_CONTROL_NEXT"
[[ "$(stat -Lc '%u:%a' "$PROTECTED_DEPLOY_CONTROL_NEXT")" == "0:640" ]]
printf '%s  %s\n' "$EXPECTED_DEPLOY_CONTROL_SHA256" \
  "$PROTECTED_DEPLOY_CONTROL_NEXT" | sha256sum --check --strict
bash -n "$PROTECTED_DEPLOY_CONTROL_NEXT"
grep -Fq 'DEPLOY_CONTROL_CAPABILITY="ai-turn-telemetry-batched-backfill-v1"' \
  "$PROTECTED_DEPLOY_CONTROL_NEXT"
sudo mv -Tf "$PROTECTED_DEPLOY_CONTROL_NEXT" "$PROTECTED_DEPLOY_CONTROL"
[[ "$(stat -Lc '%u:%a' "$PROTECTED_DEPLOY_CONTROL")" == "0:640" ]]
printf '%s  %s\n' "$EXPECTED_DEPLOY_CONTROL_SHA256" \
  "$PROTECTED_DEPLOY_CONTROL" | sha256sum --check --strict
git -C "$SOURCE_REPO" worktree remove --force "$CONTROL_STAGE"
trap - ERR INT TERM
```

Retain the root-owned backup and record both control hashes, release SHA,
manifest hash, artifact hash, CI run ID, operator, and maintenance-window time
off-host. Now invoke the protected control with the normal release inputs below.
Do not invoke a candidate checkout's copy.

## 8. Normal releases after bootstrap

Take `EXPECTED_SHA`, `EXPECTED_RELEASE_MANIFEST_SHA256`, and
`EXPECTED_RELEASE_ARTIFACT_SHA256` from the same reviewed successful hosted-CI
run. Download its SHA-named artifact using the reviewed run ID and verify the tar
digest as shown above. The deploy script fetches the branch and refuses database,
symlink, and PM2 mutation unless the branch head, tar digest, embedded release
SHA, and extracted integrity manifest all match those reviewed values:

Also supply `TRUSTED_CURRENT_SHA` and
`TRUSTED_CURRENT_MANIFEST_SHA256` from the off-host release record created after
the previous successful deployment. The deploy controller checks those values
against both `CURRENT_LINK` and every matching PM2 process before it trusts the
rollback target. Do not derive them from the deployment host at command time.

```bash
EXPECTED_SHA=<reviewed-full-40-character-ci-sha> \
EXPECTED_RELEASE_MANIFEST_SHA256=<reviewed-ci-release-manifest-sha256> \
EXPECTED_RELEASE_ARTIFACT_SHA256=<reviewed-ci-release-artifact-sha256> \
RELEASE_ARTIFACT_PATH=/var/cache/jingying-cabin-release-artifacts/<sha>/release-runtime-<sha>.tar \
TRUSTED_CURRENT_SHA=<off-host-recorded-current-release-sha> \
TRUSTED_CURRENT_MANIFEST_SHA256=<off-host-recorded-current-manifest-sha256> \
BRANCH=codex/full-project-ui \
bash /etc/jingying-cabin/release-controls/deploy.sh
```

The deploy command itself verifies and persists PM2. A successful command does
not authorize application rollback of expand migrations. After success, record
the new release SHA, manifest SHA-256, artifact SHA-256, CI run ID, and deployment
evidence in the off-host change record; those first two values are mandatory
inputs for the next deployment.
