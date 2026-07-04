#!/usr/bin/env bash
#
# 经营舱一键部署脚本（自托管服务器）。
#
#   bash scripts/deploy.sh
#
# 流程：硬重置到远端分支 → 安装依赖 → 幂等应用未执行的数据库迁移 → 构建 → 重启。
# 迁移用一张台账表 public.deploy_migrations 记录已执行文件，可安全重复运行：
#   - 首次运行：把「AI 迁移之前」的历史迁移登记为已应用（服务器既有库已含这些结构），
#     并对已手动建好的 AI 表做哨兵识别，避免重复执行 create table。
#   - 之后每次：只应用台账里没有的新迁移（单事务，失败即整体回滚）。
#
# 可用环境变量覆盖默认值：
#   APP_DIR     应用目录            （默认 /var/www/jingying-cabin）
#   BRANCH      部署分支            （默认 codex/full-project-ui）
#   DB_CONTAINER  Supabase DB 容器名（默认 supabase-db）
#   PM2_NAME    pm2 进程名          （默认 jingying-cabin）
#   SYSTEMD_UNIT systemd 服务名     （默认 jingying-cabin）
#
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/jingying-cabin}"
BRANCH="${BRANCH:-codex/full-project-ui}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PM2_NAME="${PM2_NAME:-jingying-cabin}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-jingying-cabin}"
MIGRATIONS_DIR="supabase/migrations"
# 此前缀及更早的迁移视为「服务器既有库已包含」，首次建台账时直接登记为已应用。
BASELINE_BEFORE="20260626"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "找不到应用目录：$APP_DIR（用 APP_DIR=... 覆盖）"

# psql 包装：单事务、出错即停。
db() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
db_q() { db -tAc "$1"; }

# ── 1. 拉取最新代码（硬重置，解决分支分叉报错）────────────────────────────
log "拉取并硬重置到 origin/$BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

# ── 2. 安装依赖 ──────────────────────────────────────────────────────────
# 本项目使用 pnpm（packageManager: pnpm@*，锁文件 pnpm-lock.yaml）。
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先安装（npm i -g pnpm 或 corepack enable）"
log "安装依赖（pnpm install --frozen-lockfile）"
pnpm install --frozen-lockfile

# ── 3. 幂等应用数据库迁移 ────────────────────────────────────────────────
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "找不到 DB 容器：$DB_CONTAINER（用 DB_CONTAINER=... 覆盖）"

log "确保迁移台账表存在"
db -q <<'SQL'
create table if not exists public.deploy_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
SQL

# 首次建台账（表为空）：登记基线 + 哨兵识别已手动应用的 AI 迁移。
if [ "$(db_q "select count(*) from public.deploy_migrations")" = "0" ]; then
  log "首次运行：登记基线迁移（< ${BASELINE_BEFORE}）为已应用"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    base="$(basename "$f")"
    if [[ "$base" < "$BASELINE_BEFORE" ]]; then
      db_q "insert into public.deploy_migrations(filename) values ('$base') on conflict do nothing" >/dev/null
    fi
  done
  # 哨兵：若 AI 表已被手动建好，则登记对应迁移为已应用，避免重复 create table。
  if [ -n "$(db_q "select to_regclass('public.ai_drafts')")" ]; then
    db_q "insert into public.deploy_migrations(filename) values ('20260626100000_ai_safety_foundation.sql') on conflict do nothing" >/dev/null
  fi
  if [ -n "$(db_q "select to_regclass('public.knowledge_documents')")" ]; then
    db_q "insert into public.deploy_migrations(filename) values ('20260626110000_ai_knowledge_base.sql') on conflict do nothing" >/dev/null
  fi
fi

log "应用未执行的迁移"
applied=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$f")"
  if [ -n "$(db_q "select 1 from public.deploy_migrations where filename = '$base'")" ]; then
    continue
  fi
  log "  → 应用 $base"
  db --single-transaction < "$f"
  db_q "insert into public.deploy_migrations(filename) values ('$base') on conflict do nothing" >/dev/null
  applied=$((applied + 1))
done
log "迁移完成（本次新增应用 $applied 个）"

# 迁移建了新表/新列后，PostgREST 的 schema 缓存不会自动感知（生产实测：
# 新表的所有查询报错，直到 reload）。有新迁移时通知其重载。
if [ "$applied" -gt 0 ]; then
  log "刷新 PostgREST schema 缓存"
  db_q "notify pgrst, 'reload schema'" >/dev/null || log "  （notify 失败，可手动 docker restart REST 容器）"
fi

# ── 4. 构建 ──────────────────────────────────────────────────────────────
# Node 默认堆上限约 1GB，本代码库的 TypeScript 检查在小内存服务器上会 OOM
# （SIGABRT: JavaScript heap out of memory），故默认放宽到 3GB，可用
# NODE_OPTIONS 覆盖。内存 < 4GB 的机器建议同时配置 swap。
log "构建（pnpm run build）"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}" pnpm run build

# ── 5. 重启应用 ──────────────────────────────────────────────────────────
if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "pm2 重启 $PM2_NAME"
  pm2 restart "$PM2_NAME"
elif systemctl list-units --type=service --all 2>/dev/null | grep -q "${SYSTEMD_UNIT}.service"; then
  log "systemctl 重启 $SYSTEMD_UNIT"
  sudo systemctl restart "$SYSTEMD_UNIT"
else
  log "未检测到 pm2 进程或 systemd 服务，请手动重启应用（如 pnpm start）。"
fi

log "部署完成 ✅"
