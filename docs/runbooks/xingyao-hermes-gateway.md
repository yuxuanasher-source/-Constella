# Xingyao Hermes Gateway Runbook

This runbook covers Product release evidence, deploy controls, canary enablement,
and rollback packaging for the Xingyao Hermes native intelligence restoration.
The deploy path stays repo-native and uses the existing `scripts/deploy.sh`.

## Safety Defaults

- Start every release with `XINGYAO_HERMES_GATEWAY_ENABLED=false`.
- Do not paste credentials, model identifiers, provider tokens, or connection
  strings into shell history.
- Store runtime values in root-owned env files, for example
  `/etc/jingying-cabin/xingyao-hermes.env`.
- Env files must be owned by root and mode `640`.
- Edit env files with `sudoedit`, then reload PM2 with `--update-env`.
- Evidence files must contain hashes for sensitive identifiers and command
  output, not raw values.

## Env File Pattern

Create or edit the env file with:

```sh
sudoedit /etc/jingying-cabin/xingyao-hermes.env
sudo chown root:root /etc/jingying-cabin/xingyao-hermes.env
sudo chmod 640 /etc/jingying-cabin/xingyao-hermes.env
```

The initial release state must keep the gateway off:

```sh
XINGYAO_HERMES_GATEWAY_ENABLED=false
XINGYAO_HERMES_GATEWAY_ALLOWLIST=
```

Use the service manager or PM2 ecosystem file to source this root-owned env
file. Do not inline sensitive values into ad hoc shell commands.

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
node scripts/verify-xingyao-hermes-release.mjs \
  --output artifacts/xingyao-hermes-release-evidence.json \
  --product-commit "$(git rev-parse HEAD)" \
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

## Repo-Native Deploy

Deploy the exact branch through the existing deploy script:

```sh
cd /var/www/jingying-cabin
APP_DIR=/var/www/jingying-cabin \
BRANCH=codex/hermes-native-intelligence-restoration \
PM2_NAME=jingying-cabin \
SYSTEMD_UNIT=jingying-cabin \
bash scripts/deploy.sh
pm2 restart jingying-cabin --update-env
pm2 save
```

After deploy, verify both services while the gateway is still disabled:

```sh
mkdir -p artifacts
pm2 status jingying-cabin
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
sudoedit /etc/jingying-cabin/xingyao-hermes.env
```

Set:

```sh
XINGYAO_HERMES_GATEWAY_ENABLED=true
XINGYAO_HERMES_GATEWAY_ALLOWLIST=<organization-uuid>/<user-uuid>
```

Restart PM2 with the refreshed environment:

```sh
pm2 restart jingying-cabin --update-env
pm2 save
```

Confirm that only the exact `organizationUuid` and `userUuid` pair routes to
the gateway. All other organizations and users must remain on the pre-gateway
path. The allowlist must contain exactly one `<organization-uuid>/<user-uuid>`
entry during canary; do not widen it with comma-separated or wildcard entries.

## Rollback Package

Create the rollback package before widening traffic:

```sh
bash scripts/create-xingyao-hermes-rollback.sh \
  --app-dir /var/www/jingying-cabin \
  --output-dir artifacts/xingyao-hermes-rollback \
  --product-commit "$(git rev-parse HEAD)" \
  --previous-commit "<last-known-good-product-commit>" \
  --reason "canary failed"
```

The package contains an allowlisted file snapshot, `manifest.txt` with SHA-256
values, `manifest.txt.sha256` for the manifest itself, and
`rollback-command.sh`. It intentionally excludes env files and any
credential-bearing files.

Run rollback with:

```sh
APP_DIR=/var/www/jingying-cabin PM2_NAME=jingying-cabin \
bash artifacts/xingyao-hermes-rollback/rollback-command.sh
```

The rollback command checks that `git rev-parse HEAD` equals the packaged
product commit before resetting to the previous commit. If the server has moved
for a known reason, rerun only with an explicit override:

```sh
HERMES_ROLLBACK_OVERRIDE=true APP_DIR=/var/www/jingying-cabin \
PM2_NAME=jingying-cabin \
bash artifacts/xingyao-hermes-rollback/rollback-command.sh
```

After rollback, set `XINGYAO_HERMES_GATEWAY_ENABLED=false`, clear
`XINGYAO_HERMES_GATEWAY_ALLOWLIST`, restart PM2 with `--update-env`, and record
fresh health-check evidence.
