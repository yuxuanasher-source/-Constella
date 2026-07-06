#!/usr/bin/env bash
#
# 经营舱数据库每日备份脚本（自托管服务器，阶段0 整改 R1）。
#
#   bash scripts/backup.sh
#
# 流程：pg_dump -Fc 导出 → 校验文件大小 → 上传腾讯云 COS → 本地只保留最近 N 份。
# 任一步失败：若配置了 WECOM_WEBHOOK_URL 则发企业微信文本告警（含主机名与错误
# 摘要），并以非 0 退出码结束（供 cron/监控感知）。
# crontab 配置、env 清单与验收方法见 docs/runbooks/db-backup.md。
#
# 可用环境变量覆盖默认值：
#   DB_CONTAINER      Supabase DB 容器名  （默认 supabase-db，同 deploy.sh）
#   BACKUP_DIR        本地备份目录        （默认 /var/backups/jingying-cabin）
#   BACKUP_MIN_BYTES  备份文件最小字节数  （默认 1048576=1MB，小于视为导出异常）
#   BACKUP_KEEP       本地保留份数        （默认 3）
#   WECOM_WEBHOOK_URL 企业微信机器人 webhook（可选；配置后失败才告警）
#   COS 上传所需的 BACKUP_COS_* 见 scripts/backup-upload-to-cos.mjs 头部注释。
#
# -E（errtrace）让下方的 ERR trap 在函数/子 shell 内也生效。
set -Eeuo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/jingying-cabin}"
BACKUP_MIN_BYTES="${BACKUP_MIN_BYTES:-1048576}"
BACKUP_KEEP="${BACKUP_KEEP:-3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\033[1;36m[backup]\033[0m %s\n' "$*"; }

# 失败告警：配置了 WECOM_WEBHOOK_URL 时发企业微信文本消息；告警本身失败
# 不掩盖原始错误（|| true），退出码仍由 die 决定。
alert() {
  [ -n "${WECOM_WEBHOOK_URL:-}" ] || return 0
  local content="[经营舱备份] $(hostname) 数据库备份失败：$*"
  curl -sS -m 10 -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${content}\"}}" \
    "$WECOM_WEBHOOK_URL" >/dev/null || true
}

die() {
  printf '\033[1;31m[backup] %s\033[0m\n' "$*" >&2
  alert "$*"
  exit 1
}

# set -e 兜底：凡未经 die 包装的意外失败也要发告警并保留非 0 退出码。
on_unexpected_error() {
  local exit_code=$?
  printf '\033[1;31m[backup] 备份在第 %s 行意外失败（退出码 %s）\033[0m\n' "$1" "$exit_code" >&2
  alert "备份脚本在第 $1 行意外失败（退出码 $exit_code）"
  exit "$exit_code"
}
trap 'on_unexpected_error $LINENO' ERR

# ── 1. 前置检查 ──────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "未找到 docker"
command -v node >/dev/null 2>&1 || die "未找到 node（COS 上传依赖）"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 \
  || die "找不到 DB 容器：$DB_CONTAINER（用 DB_CONTAINER=... 覆盖）"
mkdir -p "$BACKUP_DIR" || die "无法创建备份目录：$BACKUP_DIR"

DUMP_FILE="$BACKUP_DIR/db-$(date +%Y%m%d).dump"

# ── 2. pg_dump 导出（自定义格式，供 pg_restore 恢复）─────────────────────
log "导出数据库（pg_dump -Fc）→ $DUMP_FILE"
if ! docker exec "$DB_CONTAINER" pg_dump -Fc -U postgres -d postgres > "$DUMP_FILE"; then
  rm -f "$DUMP_FILE"
  die "pg_dump 导出失败（容器 $DB_CONTAINER）"
fi

# ── 3. 大小校验（过小视为导出异常，宁可失败也不留假备份）─────────────────
ACTUAL_BYTES="$(wc -c < "$DUMP_FILE" | tr -d '[:space:]')"
if [ "$ACTUAL_BYTES" -lt "$BACKUP_MIN_BYTES" ]; then
  die "备份文件过小（${ACTUAL_BYTES} < ${BACKUP_MIN_BYTES} 字节），疑似导出异常：$DUMP_FILE"
fi
log "导出完成（${ACTUAL_BYTES} 字节）"

# ── 4. 上传腾讯云 COS（db/ 前缀，env 缺失或上传失败都会非 0 退出）─────────
log "上传 COS（node scripts/backup-upload-to-cos.mjs）"
node "$SCRIPT_DIR/backup-upload-to-cos.mjs" "$DUMP_FILE" \
  || die "COS 上传失败：$DUMP_FILE"

# ── 5. 本地滚动保留最近 N 份（文件名含日期，倒序即时间倒序）───────────────
log "清理本地旧备份（保留最近 $BACKUP_KEEP 份）"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db-*.dump' \
  | sort -r \
  | tail -n +$((BACKUP_KEEP + 1)) \
  | while read -r old_file; do
      log "  → 删除 $old_file"
      rm -f "$old_file"
    done

log "备份完成 ✅ $DUMP_FILE"
