#!/usr/bin/env bash
# Create a reviewable rollback package for two already-built atomic releases.
set -euo pipefail
umask 077

RELEASE_ROOT="${RELEASE_ROOT:-/var/cache/jingying-cabin-releases}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/jingying-cabin-current}"
ENV_FILE="${ENV_FILE:-/etc/jingying-cabin/production.env}"
OUTPUT_DIR=""
PRODUCT_COMMIT=""
PREVIOUS_COMMIT=""
REASON="operator rollback"
PM2_NAME="${PM2_NAME:-jingying-cabin}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/create-xingyao-hermes-rollback.sh \
    --release-root /var/cache/jingying-cabin-releases \
    --current-link /var/www/jingying-cabin-current \
    --output-dir artifacts/xingyao-hermes-rollback \
    --product-commit <40-hex> \
    --previous-commit <40-hex> \
    --reason "canary failed"

Both commits must already be immutable, verified release directories. The
generated command switches CURRENT_LINK, reloads PM2, verifies the exact full
SHA, and persists the restored process list. It never resets a source checkout.
USAGE
}

die() { printf 'rollback package error: %s\n' "$*" >&2; exit 1; }

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --release-root) RELEASE_ROOT="${2:-}"; shift 2 ;;
    --current-link) CURRENT_LINK="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --product-commit) PRODUCT_COMMIT="${2:-}"; shift 2 ;;
    --previous-commit) PREVIOUS_COMMIT="${2:-}"; shift 2 ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ "$PRODUCT_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "--product-commit must be a lowercase full SHA"
[[ "$PREVIOUS_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "--previous-commit must be a lowercase full SHA"
[[ "$REASON" != *$'\n'* && "$REASON" != *$'\r'* ]] ||
  die "--reason must be a single line"
[[ -n "$OUTPUT_DIR" && "$OUTPUT_DIR" != "/" && "$OUTPUT_DIR" != "." && "$OUTPUT_DIR" != ".." ]] ||
  die "--output-dir must be a safe non-root path"
[[ "$RELEASE_ROOT" == /* && "$CURRENT_LINK" == /* && "$ENV_FILE" == /* ]] ||
  die "release, current-link, and env paths must be absolute"

RELEASE_ROOT="$(realpath -e -- "$RELEASE_ROOT")"
product_release="$RELEASE_ROOT/$PRODUCT_COMMIT"
previous_release="$RELEASE_ROOT/$PREVIOUS_COMMIT"
for release in "$product_release" "$previous_release"; do
  [[ -d "$release" && ! -L "$release" ]] || die "release is missing or unsafe: $release"
  [[ -f "$release/ecosystem.config.cjs" ]] || die "release lacks ecosystem config: $release"
  [[ -x "$release/scripts/verify-release.sh" ]] || die "release lacks verifier: $release"
  [[ -f "$release/scripts/deploy.sh" ]] || die "release lacks atomic deploy helpers: $release"
done
[[ -L "$CURRENT_LINK" ]] || die "CURRENT_LINK is not a symlink"
[[ "$(realpath -e -- "$CURRENT_LINK")" -ef "$product_release" ]] ||
  die "CURRENT_LINK does not point to --product-commit"

if [[ -e "$OUTPUT_DIR" ]]; then
  shopt -s nullglob dotglob
  output_entries=("$OUTPUT_DIR"/*)
  shopt -u nullglob dotglob
  (( ${#output_entries[@]} == 0 )) || die "output dir must be empty: $OUTPUT_DIR"
fi
mkdir -p -- "$OUTPUT_DIR/files"
cp -- "$product_release/scripts/deploy.sh" "$OUTPUT_DIR/files/deploy.sh"
cp -- "$product_release/scripts/verify-release.sh" "$OUTPUT_DIR/files/verify-release.sh"

cat > "$OUTPUT_DIR/rollback-command.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_ROOT="\${RELEASE_ROOT:-$RELEASE_ROOT}"
CURRENT_LINK="\${CURRENT_LINK:-$CURRENT_LINK}"
ENV_FILE="\${ENV_FILE:-$ENV_FILE}"
PM2_NAME="\${PM2_NAME:-$PM2_NAME}"
PRODUCT_COMMIT="$PRODUCT_COMMIT"
PREVIOUS_COMMIT="$PREVIOUS_COMMIT"

product_release="\$RELEASE_ROOT/\$PRODUCT_COMMIT"
[[ -f "\$product_release/scripts/deploy.sh" ]] || {
  printf 'Refusing rollback: product deploy helpers are missing\n' >&2
  exit 1
}
source "\$product_release/scripts/deploy.sh"
validate_rollback_runtime
validate_secure_env_file
load_runtime_env
validate_rollback_control_paths
acquire_deploy_lock
load_previous_release

[[ "\$previous_sha" == "\$PRODUCT_COMMIT" && "\$previous_target" -ef "\$product_release" ]] || {
  printf 'Refusing rollback: current release is not %s\n' "\$PRODUCT_COMMIT" >&2
  exit 1
}
product_target="\$previous_target"
rollback_target="\$RELEASE_ROOT/\$PREVIOUS_COMMIT"
validate_release_capabilities "\$rollback_target" "\$PREVIOUS_COMMIT"
previous_target="\$rollback_target"
previous_sha="\$PREVIOUS_COMMIT"
candidate_pm2_may_be_active=1
rollback_current
if reload_pm2 "\$PREVIOUS_COMMIT" && verify_release "\$PREVIOUS_COMMIT" && save_pm2; then
  printf 'Rollback verified and persisted at %s\n' "\$PREVIOUS_COMMIT"
  exit 0
fi

printf 'Rollback activation failed; restoring product release %s\n' "\$PRODUCT_COMMIT" >&2
previous_target="\$product_target"
previous_sha="\$PRODUCT_COMMIT"
rollback_current
reload_pm2 "\$PRODUCT_COMMIT"
verify_release "\$PRODUCT_COMMIT"
save_pm2
exit 1
EOF
chmod 750 "$OUTPUT_DIR/rollback-command.sh"

manifest_files=(
  "$OUTPUT_DIR/files/deploy.sh"
  "$OUTPUT_DIR/files/verify-release.sh"
  "$OUTPUT_DIR/rollback-command.sh"
)
{
  printf 'package=xingyao-hermes-atomic-rollback\n'
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'release_root=%s\n' "$RELEASE_ROOT"
  printf 'current_link=%s\n' "$CURRENT_LINK"
  printf 'product_commit=%s\n' "$PRODUCT_COMMIT"
  printf 'previous_commit=%s\n' "$PREVIOUS_COMMIT"
  printf 'reason=%s\n' "$REASON"
  for file in "${manifest_files[@]}"; do
    rel="${file#"$OUTPUT_DIR/"}"
    hash="$(sha256sum "$file" | awk '{print $1}')"
    printf 'sha256(%s)=%s\n' "$rel" "$hash"
  done
} > "$OUTPUT_DIR/manifest.txt"
manifest_hash="$(sha256sum "$OUTPUT_DIR/manifest.txt" | awk '{print $1}')"
printf '%s  manifest.txt\n' "$manifest_hash" > "$OUTPUT_DIR/manifest.txt.sha256"
printf 'Created atomic rollback package: %s\n' "$OUTPUT_DIR"
