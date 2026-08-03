# Xingyao Hermes Gateway Runbook

This runbook covers Product release evidence, deploy controls, canary enablement,
and rollback packaging for the Xingyao Hermes native intelligence restoration.
The deploy path stays repo-native and uses the existing `scripts/deploy.sh`.

## Safety Defaults

- Start every release with `XINGYAO_HERMES_GATEWAY_ENABLED=false`.
- Do not paste credentials, model identifiers, provider tokens, or connection
  strings into shell history.
- Store every application runtime value in the one env file that the atomic
  deploy actually loads: `/etc/jingying-cabin/production.env`.
- The env file must be owned by root, readable by the deployment group, and
  mode `640`.
- Edit it with `sudoedit`, explicitly source it, then reload PM2 with
  `--update-env`.
- Evidence files must contain hashes for sensitive identifiers and command
  output, not raw values.

## Env File Pattern

Create or edit the env file with:

```sh
sudoedit /etc/jingying-cabin/production.env
sudo chown root:"$(id -gn)" /etc/jingying-cabin/production.env
sudo chmod 640 /etc/jingying-cabin/production.env
```

The initial release state must keep the gateway off:

```sh
XINGYAO_HERMES_GATEWAY_ENABLED=false
XINGYAO_HERMES_GATEWAY_ALLOWLIST=
```

Do not create a second Hermes env file: `scripts/deploy.sh` intentionally loads
only `ENV_FILE`, so a second file can look correct while production continues
running stale values. Do not inline sensitive values into ad hoc shell commands.

If the model identifier is not already available in a root-owned env file, store
it in a separate root-owned `640` file and edit it only with `sudoedit`:

```sh
sudoedit /etc/jingying-cabin/xingyao-hermes-model-identifier
sudo chown root:root /etc/jingying-cabin/xingyao-hermes-model-identifier
sudo chmod 640 /etc/jingying-cabin/xingyao-hermes-model-identifier
```

## Release Evidence

Before enabling the canary, create a release evidence JSON file. It must record:

- Product repo commit.
- Xingyao Hermes fork commit.
- Upstream tag and upstream commit.
- Protocol and profile.
- Model identifier SHA-256 hash.
- Schema migration SHA-256 hash.
- Test names, statuses, and output SHA-256 hashes.
- Artifact SHA-256 values.

Example:

```sh
CURRENT_LINK=/var/www/jingying-cabin-current
PRODUCT_RELEASE="$(realpath -e "$CURRENT_LINK")"
PRODUCT_COMMIT="$(basename "$PRODUCT_RELEASE")"
[[ "$PRODUCT_COMMIT" =~ ^[0-9a-f]{40}$ ]]
PRODUCT_MANIFEST_SHA256="$(
  curl --fail --silent --show-error http://127.0.0.1:3000/api/health |
    PRODUCT_COMMIT="$PRODUCT_COMMIT" node -e '
      const fs = require("node:fs");
      const body = JSON.parse(fs.readFileSync(0, "utf8"));
      if (
        body.ok !== true ||
        body.release?.sha !== process.env.PRODUCT_COMMIT ||
        !/^[0-9a-f]{64}$/.test(body.release?.manifestSha256 ?? "")
      ) process.exit(1);
      process.stdout.write(body.release.manifestSha256);
    '
)"
timeout --signal=TERM --kill-after=5s 30s pm2 jlist |
  PRODUCT_RELEASE="$PRODUCT_RELEASE" PRODUCT_COMMIT="$PRODUCT_COMMIT" \
    PRODUCT_MANIFEST_SHA256="$PRODUCT_MANIFEST_SHA256" node -e '
    const fs = require("node:fs");
    const release = fs.realpathSync(process.env.PRODUCT_RELEASE);
    const apps = JSON.parse(fs.readFileSync(0, "utf8"))
      .filter((entry) => entry?.name === "jingying-cabin");
    if (
      apps.length === 0 ||
      apps.some((entry) => {
        const env = entry?.pm2_env;
        return (
          !env ||
          env.RELEASE_SHA !== process.env.PRODUCT_COMMIT ||
          env.RELEASE_MANIFEST_SHA256 !==
            process.env.PRODUCT_MANIFEST_SHA256 ||
          fs.realpathSync(env.pm_cwd) !== release
        );
      })
    ) process.exit(1);
  '
TRUSTED_RELEASE_INTEGRITY=/etc/jingying-cabin/release-controls/release-integrity.mjs
[[ "$(stat -Lc '%u:%a' "$TRUSTED_RELEASE_INTEGRITY")" == "0:640" ]]
node "$TRUSTED_RELEASE_INTEGRITY" verify \
  "$PRODUCT_RELEASE" "$PRODUCT_COMMIT" "$PRODUCT_MANIFEST_SHA256"

node scripts/verify-xingyao-hermes-release.mjs \
  --output artifacts/xingyao-hermes-release-evidence.json \
  --product-commit "$PRODUCT_COMMIT" \
  --fork-commit "<xingyao-hermes-fork-commit>" \
  --upstream-tag "<upstream-tag>" \
  --upstream-commit "<upstream-commit>" \
  --protocol "hermes-native-gateway" \
  --profile "production-canary" \
  --model-identifier-file /etc/jingying-cabin/xingyao-hermes-model-identifier \
  --schema-migration-file supabase/migrations/<hermes-migration>.sql \
  --test-result "curl 8642 healthz=passed:artifacts/hermes-8642-healthz.log" \
  --test-result "curl 8643 healthz=passed:artifacts/hermes-8643-healthz.log" \
  --test-result "pnpm test:ai-system=passed:artifacts/test-ai-system.log" \
  --artifact "rollback-script=scripts/create-xingyao-hermes-rollback.sh"
```

Review the JSON before sharing it. It should include hashes, not raw provider
values or command output.

## Atomic Release Deploy

The first managed release must follow
`docs/runbooks/atomic-release-bootstrap.md`. Subsequent releases use the locked,
immutable release pipeline. Hermes changes must first be reviewed and merged into
`codex/full-project-ui`; deploy only the successful push artifact for that default
branch and use that merged commit as `EXPECTED_SHA`:

For the first release containing migration `20260803120500`, complete the
**protected control upgrade** in section 7 of
`docs/runbooks/atomic-release-bootstrap.md` before running this command. Record
and verify `EXPECTED_DEPLOY_CONTROL_SHA256` from the same reviewed CI run. An old
or mismatched protected control will fail closed before applying that migration.

```sh
SOURCE_REPO=/var/www/jingying-cabin \
RELEASE_ROOT=/var/cache/jingying-cabin-releases \
CURRENT_LINK=/var/www/jingying-cabin-current \
ENV_FILE=/etc/jingying-cabin/production.env \
BRANCH=codex/full-project-ui \
EXPECTED_SHA=<reviewed-full-40-character-ci-sha> \
EXPECTED_RELEASE_MANIFEST_SHA256=<reviewed-ci-release-manifest-sha256> \
EXPECTED_RELEASE_ARTIFACT_SHA256=<reviewed-ci-release-artifact-sha256> \
RELEASE_ARTIFACT_PATH=/var/cache/jingying-cabin-release-artifacts/<sha>/release-runtime-<sha>.tar \
TRUSTED_CURRENT_SHA=<off-host-recorded-current-release-sha> \
TRUSTED_CURRENT_MANIFEST_SHA256=<off-host-recorded-current-manifest-sha256> \
PM2_NAME=jingying-cabin \
bash /etc/jingying-cabin/release-controls/deploy.sh
```

Retrieve the SHA-named artifact by reviewed successful CI run ID and verify its
tar SHA-256 exactly as specified in the atomic bootstrap runbook. The deploy
command already verifies and persists PM2. After deploy, verify both services
while the gateway is still disabled:

```sh
mkdir -p artifacts
timeout --signal=TERM --kill-after=5s 30s pm2 status jingying-cabin
systemctl status jingying-cabin --no-pager
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8642/healthz | tee artifacts/hermes-8642-healthz.log
curl -fsS http://127.0.0.1:8643/healthz | tee artifacts/hermes-8643-healthz.log
```

Record both `8642` and `8643` outputs in release evidence before canary
enablement. The evidence script stores their SHA-256 values, not raw output.

## Canary Enablement

Only after both services are healthy, enable exactly one canary pair:

```sh
sudoedit /etc/jingying-cabin/production.env
```

Set:

```sh
XINGYAO_HERMES_GATEWAY_ENABLED=true
XINGYAO_HERMES_GATEWAY_ALLOWLIST=<organization-uuid>/<user-uuid>
```

Source the authoritative file and restart PM2 with the refreshed environment:

```sh
set -a
source /etc/jingying-cabin/production.env
set +a
timeout --signal=TERM --kill-after=5s 30s pm2 restart jingying-cabin --update-env
timeout --signal=TERM --kill-after=5s 30s pm2 save
timeout --signal=TERM --kill-after=5s 30s pm2 jlist | node -e '
  const fs = require("node:fs");
  const apps = JSON.parse(fs.readFileSync(0, "utf8"))
    .filter(({ name }) => name === "jingying-cabin")
    .map(({ pm2_env: env = {} }) => ({
      enabled: env.XINGYAO_HERMES_GATEWAY_ENABLED,
      allowlist: env.XINGYAO_HERMES_GATEWAY_ALLOWLIST,
    }));
  if (
    apps.length === 0 ||
    apps.some(({ enabled, allowlist }) =>
      enabled !== "true" ||
      !/^[0-9a-f-]+\/[0-9a-f-]+$/i.test(allowlist ?? "")
    )
  ) process.exit(1);
  process.stdout.write("Hermes canary env verified for every PM2 instance\n");
'
```

Confirm that only the exact `organizationUuid` and `userUuid` pair routes to
the gateway. All other organizations and users must remain on the pre-gateway
path. The allowlist must contain exactly one `<organization-uuid>/<user-uuid>`
entry during canary; do not widen it with comma-separated or wildcard entries.

## Rollback Package

Create the rollback package before widening traffic:

```sh
CURRENT_LINK=/var/www/jingying-cabin-current
RELEASE_ROOT=/var/cache/jingying-cabin-releases
PRODUCT_RELEASE="$(realpath -e "$CURRENT_LINK")"
PRODUCT_COMMIT="$(basename "$PRODUCT_RELEASE")"
# This value was already checked against health, PM2, and release integrity in
# the Release Evidence procedure above.
[[ "$PRODUCT_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]
PREVIOUS_COMMIT="<last-known-good-product-commit>"
PREVIOUS_MANIFEST_SHA256="<reviewed-last-known-good-manifest-sha256>"
TRUSTED_RELEASE_INTEGRITY=/etc/jingying-cabin/release-controls/release-integrity.mjs
[[ "$(stat -Lc '%u:%a' "$TRUSTED_RELEASE_INTEGRITY")" == "0:640" ]]
node "$TRUSTED_RELEASE_INTEGRITY" verify \
  "$RELEASE_ROOT/$PREVIOUS_COMMIT" \
  "$PREVIOUS_COMMIT" "$PREVIOUS_MANIFEST_SHA256"

bash "$CURRENT_LINK/scripts/create-xingyao-hermes-rollback.sh" \
  --release-root "$RELEASE_ROOT" \
  --current-link "$CURRENT_LINK" \
  --output-dir artifacts/xingyao-hermes-rollback \
  --product-commit "$PRODUCT_COMMIT" \
  --product-manifest-sha256 "$PRODUCT_MANIFEST_SHA256" \
  --previous-commit "$PREVIOUS_COMMIT" \
  --previous-manifest-sha256 "$PREVIOUS_MANIFEST_SHA256" \
  --reason "canary failed"
```

The package contains the reviewed atomic deploy/verifier helpers, hashes, and a
`rollback-command.sh`. It never copies env files and never resets a source
checkout. Both release SHAs must already exist under `RELEASE_ROOT`.

Run rollback with:

```sh
PACKAGE_DIR="$(realpath -e artifacts/xingyao-hermes-rollback)"
export EXPECTED_MANIFEST_SHA256=<reviewed-hash-printed-at-package-creation>
export RELEASE_ROOT=/var/cache/jingying-cabin-releases
export CURRENT_LINK=/var/www/jingying-cabin-current
export ENV_FILE=/etc/jingying-cabin/production.env
export PM2_NAME=jingying-cabin
TRUSTED_ROLLBACK_PACKAGE_VERIFIER=/etc/jingying-cabin/release-controls/verify-xingyao-hermes-rollback-package.mjs
[[ "$(stat -Lc '%u:%a' "$TRUSTED_ROLLBACK_PACKAGE_VERIFIER")" == "0:640" ]]
node "$TRUSTED_ROLLBACK_PACKAGE_VERIFIER" \
  execute "$PACKAGE_DIR" "$EXPECTED_MANIFEST_SHA256"
```

Keep the reviewed manifest hash outside the package. The root-owned verifier
installed during atomic bootstrap is independent of `CURRENT_LINK`; it checks
the manifest and every packaged file, including `rollback-command.sh`, before it
starts that command. The command then sources only the verified packaged deploy
helper, acquires the same host lock, verifies the current full SHA and manifest,
atomically switches the symlink, reloads and exactly verifies every matching PM2
instance, then persists PM2. Failure restores the packaged product release; both
directories are retained for recovery.

After rollback, edit the protected `ENV_FILE` to set
`XINGYAO_HERMES_GATEWAY_ENABLED=false` and clear
`XINGYAO_HERMES_GATEWAY_ALLOWLIST`. Reload and verify the current managed
release, then persist the disabled gateway state:

```sh
set -a
source /etc/jingying-cabin/production.env
set +a
CURRENT_LINK=/var/www/jingying-cabin-current
RELEASE_ROOT=/var/cache/jingying-cabin-releases
RESTORED_SHA="$(basename "$(realpath -e "$CURRENT_LINK")")"
RESTORED_MANIFEST_SHA256="$PREVIOUS_MANIFEST_SHA256"
CURRENT_LINK="$CURRENT_LINK" PM2_NAME=jingying-cabin \
  RELEASE_SHA="$RESTORED_SHA" \
  RELEASE_MANIFEST_SHA256="$RESTORED_MANIFEST_SHA256" \
  timeout --signal=TERM --kill-after=5s 30s pm2 startOrReload \
  "$CURRENT_LINK/ecosystem.config.cjs" --update-env
CURRENT_LINK="$CURRENT_LINK" RELEASE_ROOT="$RELEASE_ROOT" \
  PM2_NAME=jingying-cabin \
  "$CURRENT_LINK/scripts/verify-release.sh" \
  "$RESTORED_SHA" "$RESTORED_MANIFEST_SHA256"
timeout --signal=TERM --kill-after=5s 30s pm2 save
```
