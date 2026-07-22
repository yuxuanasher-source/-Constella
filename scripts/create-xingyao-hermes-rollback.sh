#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/jingying-cabin"
OUTPUT_DIR=""
PRODUCT_COMMIT=""
PREVIOUS_COMMIT=""
REASON="operator rollback"
PM2_NAME="${PM2_NAME:-jingying-cabin}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/create-xingyao-hermes-rollback.sh \
    --app-dir /var/www/jingying-cabin \
    --output-dir artifacts/xingyao-hermes-rollback \
    --product-commit <40-hex> \
    --previous-commit <40-hex> \
    --reason "canary failed"

Creates an allowlisted rollback package with a manifest, file hashes, and a
rollback command. Env files and credential-bearing files are never copied.
USAGE
}

die() {
  printf 'rollback package error: %s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --product-commit)
      PRODUCT_COMMIT="${2:-}"
      shift 2
      ;;
    --previous-commit)
      PREVIOUS_COMMIT="${2:-}"
      shift 2
      ;;
    --reason)
      REASON="${2:-}"
      shift 2
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$PRODUCT_COMMIT" in
  [a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9]) ;;
  *) die "--product-commit must be a 40 character commit" ;;
esac

case "$PREVIOUS_COMMIT" in
  [a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9]) ;;
  *) die "--previous-commit must be a 40 character commit" ;;
esac

[ -n "$OUTPUT_DIR" ] || die "--output-dir is required"
[ -d "$APP_DIR" ] || die "app dir does not exist: $APP_DIR"

case "$OUTPUT_DIR" in
  ""|"/"|"."|"..") die "unsafe output dir: $OUTPUT_DIR" ;;
esac

if [ -e "$OUTPUT_DIR" ] && [ -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]; then
  die "output dir must be empty: $OUTPUT_DIR"
fi

mkdir -p "$OUTPUT_DIR/files"

copy_if_exists() {
  local rel="$1"
  local src="$APP_DIR/$rel"
  local dest="$OUTPUT_DIR/files/$rel"

  [ -f "$src" ] || return 0

  case "$rel" in
    *.env|*.env.*|.env|.env.*|*credential*|*private*|*key*) return 0 ;;
  esac

  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
}

copy_if_exists "scripts/deploy.sh"
copy_if_exists "docs/runbooks/xingyao-hermes-gateway.md"

if [ -d "$APP_DIR/supabase/migrations" ]; then
  while IFS= read -r migration; do
    rel="${migration#"$APP_DIR/"}"
    copy_if_exists "$rel"
  done < <(find "$APP_DIR/supabase/migrations" -type f -name '*hermes*.sql' | sort)
fi

cat > "$OUTPUT_DIR/rollback-command.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="\${APP_DIR:-/var/www/jingying-cabin}"
PM2_NAME="\${PM2_NAME:-$PM2_NAME}"
PRODUCT_COMMIT="$PRODUCT_COMMIT"
PREVIOUS_COMMIT="$PREVIOUS_COMMIT"
HERMES_ROLLBACK_OVERRIDE="\${HERMES_ROLLBACK_OVERRIDE:-false}"

cd "\$APP_DIR"
current_commit="\$(git rev-parse HEAD)"
if [ "\$current_commit" != "\$PRODUCT_COMMIT" ] && [ "\$HERMES_ROLLBACK_OVERRIDE" != "true" ]; then
  printf 'Refusing rollback: HEAD %s does not match expected product commit %s. Set HERMES_ROLLBACK_OVERRIDE=true to override.\n' "\$current_commit" "\$PRODUCT_COMMIT" >&2
  exit 1
fi

git fetch origin
git reset --hard "\$PREVIOUS_COMMIT"
pnpm install --frozen-lockfile
pnpm run build
pm2 restart "\$PM2_NAME" --update-env
pm2 save
EOF
chmod 750 "$OUTPUT_DIR/rollback-command.sh"

{
  printf 'package=xingyao-hermes-rollback\n'
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'app_dir=%s\n' "$APP_DIR"
  printf 'product_commit=%s\n' "$PRODUCT_COMMIT"
  printf 'previous_commit=%s\n' "$PREVIOUS_COMMIT"
  printf 'reason=%s\n' "$REASON"
  while IFS= read -r file; do
    rel="${file#"$OUTPUT_DIR/"}"
    hash="$(sha256sum "$file" | awk '{print $1}')"
    printf 'sha256(%s)=%s\n' "$rel" "$hash"
  done < <(find "$OUTPUT_DIR" -type f ! -name manifest.txt | sort)
} > "$OUTPUT_DIR/manifest.txt"

manifest_hash="$(sha256sum "$OUTPUT_DIR/manifest.txt" | awk '{print $1}')"
printf '%s  manifest.txt\n' "$manifest_hash" > "$OUTPUT_DIR/manifest.txt.sha256"

printf 'Created rollback package: %s\n' "$OUTPUT_DIR"
