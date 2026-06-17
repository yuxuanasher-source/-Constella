# 腾讯云轻量服务器部署教程（自建 Supabase + Next.js）

本教程把「经营舱」部署到一台腾讯云轻量应用服务器上，采用 **方案 A：在服务器上用 Docker 自建整套 Supabase（self-host）**。
这样数据库 / 登录鉴权(Auth) / 文件存储(Storage) / 行级权限(RLS) 全部跑在你自己的服务器上，数据归你，代码几乎不用改。

> ⚠️ **为什么不能直接换成「腾讯云数据库 PostgreSQL」？**
> 本项目不是只用数据库，还深度依赖 Supabase 的 Auth、Storage、以及基于 `auth.uid()` 的 RLS 权限，
> 前端 SDK `@supabase/supabase-js` 连的是 Supabase 的 API 网关而非裸数据库。
> 直接换成腾讯云数据库会让登录、上传、权限全部失效，等于一次大重构。自建 Supabase 才是正解。

---

## 0. 架构总览

```
浏览器 (https://app.your-domain.com)
        │
        ▼
   Nginx (443/SSL, 反向代理)
        ├── app.your-domain.com → 127.0.0.1:3000   Next.js (PM2 守护)
        └── api.your-domain.com → 127.0.0.1:8000   Supabase 网关(Kong)
                                        │
                            Supabase self-host (Docker Compose)
                            Postgres / Auth / PostgREST / Storage / Realtime ...
```

需要 **两个子域名**（都解析到这台服务器公网 IP）：
- `app.your-domain.com` —— 给用户访问的应用
- `api.your-domain.com` —— Supabase 网关（必须公网可达，因为浏览器要直接连它做登录）

---

## 1. 准备工作（开始前确认）

- [ ] 服务器内存 **≥ 2GB（推荐 4GB）**。Supabase 是一整套容器，1GB 会非常吃力。
      查内存：`free -h`
- [ ] 在腾讯云控制台「防火墙」里放行端口：**22(SSH)、80(HTTP)、443(HTTPS)**。
      ⚠️ 不要对公网开放 5432/8000 等内部端口，只通过 Nginx 暴露。
- [ ] 域名已实名 + **已备案**（国内服务器用 80/443 必须备案，否则会被拦截）。
- [ ] 两个子域名 A 记录都指向服务器公网 IP。
- [ ] 用 SSH 登录服务器（以下命令默认用 root 或 sudo 执行）。

---

## 2. 安装基础环境（Docker、Node、pnpm、Nginx）

```bash
# 更新系统
apt update && apt -y upgrade        # Ubuntu/Debian
# CentOS/TencentOS 用: yum -y update

# 安装 Docker + docker compose 插件
curl -fsSL https://get.docker.com | bash
systemctl enable --now docker
docker compose version              # 验证

# 安装 Node 20（Next 16 需要 Node 20.9+）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v                             # 应显示 v20.x

# 安装 pnpm（项目锁定 10.12.1）
npm i -g pnpm@10.12.1
pnpm -v

# 安装 Nginx 与 certbot（HTTPS 证书）
apt -y install nginx certbot python3-certbot-nginx git
systemctl enable --now nginx
```

> 国内拉取 Docker 镜像慢的话，可在 `/etc/docker/daemon.json` 配置镜像加速器后 `systemctl restart docker`。

---

## 3. 自建 Supabase（Docker Compose）

```bash
# 把官方 self-host 模板拉下来（只需要 docker 目录）
mkdir -p /opt && cd /opt
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

### 3.1 生成密钥并写入 .env

需要改 `/opt/supabase/docker/.env` 里这几项（**务必全部换成自己的强随机值**）：

| 变量 | 说明 | 怎么生成 |
|---|---|---|
| `POSTGRES_PASSWORD` | 数据库密码 | `openssl rand -hex 24` |
| `JWT_SECRET` | 签发 JWT 的密钥（≥32位） | `openssl rand -hex 32` |
| `ANON_KEY` | 匿名 key（前端用） | 见下方 |
| `SERVICE_ROLE_KEY` | 服务端高权限 key | 见下方 |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Studio 后台登录 | 自定义 |
| `SITE_URL` | `https://app.your-domain.com` | 你的应用域名 |
| `API_EXTERNAL_URL` | `https://api.your-domain.com` | 你的 Supabase 域名 |
| `SUPABASE_PUBLIC_URL` | `https://api.your-domain.com` | 同上 |

**生成 ANON_KEY / SERVICE_ROLE_KEY**：这两个是用上面的 `JWT_SECRET` 签出来的 JWT。
最省事的方法是用 Supabase 官方网页工具：打开
<https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys>
把你的 `JWT_SECRET` 填进去，分别生成 role=`anon` 和 role=`service_role` 的 key，复制回 `.env`。

> 这两个 key 之后要原样填进经营舱项目的 `.env.local`（见第 5 步）。

### 3.2 启动 Supabase

```bash
cd /opt/supabase/docker
docker compose pull
docker compose up -d
docker compose ps          # 全部 healthy 即成功（首次启动等 1~2 分钟）
```

此时内部网关在 `127.0.0.1:8000`，先不对公网开放，等第 6 步用 Nginx + HTTPS 暴露。

---

## 4. 把项目的数据库迁移导入自建库

项目的表结构 / RLS 都在 `supabase/migrations/*.sql`。把它们应用到刚建好的自建库：

```bash
# 在你本机或服务器上、经营舱项目目录里执行
# 用 Supabase CLI 直连自建库推送迁移（推荐）
pnpm dlx supabase db push \
  --db-url "postgresql://postgres:你的POSTGRES_PASSWORD@127.0.0.1:5432/postgres"
```

> 如果 CLI 连接不便，也可以逐个用 psql 应用：
> `for f in supabase/migrations/*.sql; do psql "$DB_URL" -f "$f"; done`
> （注意按文件名时间顺序执行，迁移之间有依赖。）

### 4.1 建私有存储桶

代码默认用名为 `jy-private` 的私有桶。登录 Supabase Studio
（`https://api.your-domain.com` 的 Studio，或先临时 SSH 端口转发到 `127.0.0.1:8000`），
在 **Storage** 里新建桶 `jy-private`，**关闭 Public**（保持私有）。

---

## 5. 部署 Next.js 应用

```bash
# 拉代码（换成你的仓库地址与分支）
cd /opt
git clone <你的仓库地址> jingying-cabin
cd jingying-cabin

# 配置环境变量
cp .env.production.example .env.local
vi .env.local      # 按模板填入第 3 步生成的 URL / anon / service_role key
```

`.env.local` 关键值对应关系：
- `NEXT_PUBLIC_SUPABASE_URL` = `https://api.your-domain.com`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = 第 3.1 步的 `ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` = 第 3.1 步的 `SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` = `https://app.your-domain.com`
- `SUPABASE_PRIVATE_BUCKET` = `jy-private`

```bash
# 安装依赖 + 构建（NEXT_PUBLIC_* 必须在 build 前就位）
pnpm install --frozen-lockfile
pnpm build

# 用 PM2 守护进程启动
npm i -g pm2
pm2 start deploy/pm2/ecosystem.config.js
pm2 save
pm2 startup        # 按提示执行它输出的那条命令，实现开机自启
```

应用现在跑在 `127.0.0.1:3000`。

---

## 6. 配置 Nginx 反向代理 + HTTPS

```bash
# 拷贝两个站点模板（仓库 deploy/nginx/ 下）
cp deploy/nginx/app.conf.example /etc/nginx/conf.d/app.conf
cp deploy/nginx/api.conf.example /etc/nginx/conf.d/api.conf
# 把两个文件里的 your-domain.com 改成你的真实域名
sed -i 's/your-domain.com/真实域名/g' /etc/nginx/conf.d/app.conf /etc/nginx/conf.d/api.conf

nginx -t && systemctl reload nginx

# 一键签发并自动配置 HTTPS（会自动改写 80→443 跳转）
certbot --nginx -d app.your-domain.com -d api.your-domain.com
```

证书自动续期已由 certbot 的 systemd timer 处理，无需手动。

---

## 7. 收尾配置

1. **Supabase Auth 回调白名单**：确认 `/opt/supabase/docker/.env` 里
   `SITE_URL=https://app.your-domain.com`、`API_EXTERNAL_URL=https://api.your-domain.com`，
   改动后 `docker compose up -d` 重启生效。
2. **创建首个账号**：本项目不再内置演示账号，通过 Supabase Studio 的 Auth 或后台流程创建真实测试账号。
3. **邮件**：自建 Supabase 默认用内置 inbucket（不真正发信）。要发验证邮件需在 `.env` 配置 SMTP（可用腾讯企业邮/SES）。

---

## 8. 验证清单

- [ ] `https://api.your-domain.com` 能打开（Supabase 返回页面/JSON）
- [ ] `https://app.your-domain.com/console/projects` 能打开经营 Web
- [ ] 能注册/登录（验证 Auth + JWT 链路）
- [ ] 能创建项目草稿并发布（验证数据库 + RLS）
- [ ] 能上传文件（验证 Storage 桶 `jy-private`）
- [ ] `pm2 logs`、`docker compose logs` 无明显报错

---

## 9. 日常运维速查

```bash
# 应用更新上线
cd /opt/jingying-cabin && git pull
pnpm install --frozen-lockfile && pnpm build && pm2 reload jingying-cabin

# 看日志
pm2 logs jingying-cabin
cd /opt/supabase/docker && docker compose logs -f

# 数据库备份（强烈建议设成定时任务）
docker exec -t supabase-db pg_dump -U postgres postgres > /opt/backup/db_$(date +%F).sql
```

---

## 常见坑

- **登录报跨域/连不上**：`NEXT_PUBLIC_SUPABASE_URL` 必须是浏览器可访问的 **公网 HTTPS** 子域名，
  不能填 `127.0.0.1`。改完要重新 `pnpm build`（NEXT_PUBLIC_ 变量是构建期注入的）。
- **上传失败**：确认环境变量名是 `SUPABASE_PRIVATE_BUCKET`（不是 `.env.example` 里那个旧名
  `STORAGE_BUCKET_PRIVATE`），且桶 `jy-private` 已建好且为私有。
- **内存不够**：自建 Supabase + Next.js 构建较吃内存。1~2GB 机器建议加 2GB swap：
  `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
- **80/443 打不开**：检查腾讯云防火墙是否放行，以及域名是否已备案。
