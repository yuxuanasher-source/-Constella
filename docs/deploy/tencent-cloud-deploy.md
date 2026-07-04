# 腾讯云轻量服务器部署教程（自建 Supabase + Next.js）· 详细版

把「经营舱」部署到腾讯云轻量应用服务器，采用 **方案 A：在服务器上用 Docker 自建整套 Supabase（self-host）**。
数据库 / 登录鉴权(Auth) / 文件存储(Storage) / 行级权限(RLS) 全部跑在你自己的服务器上，数据归你，应用代码几乎不用改。

> 本教程默认系统为 **Ubuntu 22.04/24.04**（腾讯云轻量最常见）。如果是 TencentOS/CentOS，把 `apt` 换成 `yum`/`dnf`，其余基本一致，差异处会单独标注。
> 命令默认用 `root` 执行；若你是普通用户，前面加 `sudo`。

> ⚠️ **为什么不能直接换成「腾讯云数据库 PostgreSQL」？**
> 本项目不只是用数据库，还深度依赖 Supabase 的 Auth、Storage、基于 `auth.uid()` 的 RLS，
> 前端 SDK `@supabase/supabase-js` 连的是 Supabase 的 API 网关而非裸库。直接换库会让登录/上传/权限全部失效。

---

## 你的机器：2核 2GB / 40G —— 必读

2GB 是自建 Supabase 的**下限**。务必做以下三件事，否则会因内存不足崩溃：
1. **加 4GB swap**（第 1.3 步）——最关键。
2. **构建 Next.js 时限制内存**（第 6.3 步用 `NODE_OPTIONS`）。
3. （可选）**关掉 Supabase 里最吃内存的非必需容器**（第 4.4 步）。

做完这些，2核2GB 能稳定承载一个中小流量的内部系统。如果以后用户量上来，建议升级到 4GB。

---

## 0. 架构总览

```
浏览器  →  Nginx(443/SSL 反向代理)
            ├── app.你的域名  → 127.0.0.1:3000   Next.js（PM2 守护）
            └── api.你的域名  → 127.0.0.1:8000   Supabase 网关(Kong)
                                       │
                         Supabase self-host（Docker Compose）
                         Postgres / Auth / PostgREST / Storage / ...
```

你需要 **两个子域名**，都解析到服务器公网 IP：
| 子域名 | 用途 | 反代目标 |
|---|---|---|
| `app.你的域名` | 用户访问的应用 | `127.0.0.1:3000` |
| `api.你的域名` | Supabase 网关（浏览器登录要直连它，必须公网可达） | `127.0.0.1:8000` |

---

## 第 1 步：服务器基础准备

### 1.1 放行端口（腾讯云控制台操作）
进入 **腾讯云控制台 → 轻量应用服务器 → 你的实例 → 防火墙**，新增放行规则，放行：
- `TCP 22`（SSH，通常已开）
- `TCP 80`（HTTP）
- `TCP 443`（HTTPS）

⚠️ **不要**对公网开放 `5432`/`8000` 等内部端口，它们只通过 Nginx 暴露。

### 1.2 SSH 登录并更新系统
在你自己电脑的终端执行（把 IP 换成你的服务器公网 IP）：
```bash
ssh root@你的服务器公网IP
```
登录后更新系统包：
```bash
apt update && apt -y upgrade
# CentOS/TencentOS: yum -y update
```

### 1.3 ⭐创建 4GB swap（2GB 内存必做）
swap 是"虚拟内存"，把硬盘当内存用，防止内存满了直接崩溃。你有 40G 系统盘，拿 4G 出来：
```bash
# 创建 4G 交换文件
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
# 设为开机自动挂载
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
**验证**：执行 `free -h`，看到 `Swap:` 那一行显示 `4.0Gi` 即成功：
```
              total   used   free
Mem:          1.9Gi  ...    ...
Swap:         4.0Gi  0B     4.0Gi      ← 出现这行就对了
```

### 1.4 域名解析与备案
- 域名需**已实名 + 已备案**（国内服务器用 80/443 必须备案，否则被运营商拦截）。
- 去你的域名 DNS 服务商，加两条 **A 记录**，都指向服务器公网 IP：
  - 主机记录 `app` → 你的公网 IP
  - 主机记录 `api` → 你的公网 IP
- **验证**（在自己电脑执行）：`ping app.你的域名`，能解析到你的公网 IP 即生效（可能要等几分钟）。

---

## 第 2 步：安装运行环境

逐条执行，每条都附带验证命令。

### 2.1 安装 Docker
```bash
curl -fsSL https://get.docker.com | bash
systemctl enable --now docker
```
**验证**：`docker compose version` 输出版本号（如 `Docker Compose version v2.x`）即成功。

> 国内拉镜像慢/失败时，配置镜像加速：
> ```bash
> mkdir -p /etc/docker
> cat > /etc/docker/daemon.json <<'EOF'
> { "registry-mirrors": ["https://docker.m.daocloud.io"] }
> EOF
> systemctl restart docker
> ```

### 2.2 安装 Node 20（Next 16 要求 20.9+）
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
```
**验证**：`node -v` 显示 `v20.x.x`。

### 2.3 安装 pnpm（项目锁定 10.12.1）
```bash
npm i -g pnpm@10.12.1
```
**验证**：`pnpm -v` 显示 `10.12.1`。

### 2.4 安装 Nginx、certbot、git
```bash
apt -y install nginx certbot python3-certbot-nginx git
systemctl enable --now nginx
```
**验证**：浏览器访问 `http://你的公网IP`，看到 Nginx 欢迎页即成功。

---

## 第 3 步：拉取并配置自建 Supabase

### 3.1 下载官方 self-host 模板
```bash
mkdir -p /opt && cd /opt
git clone --depth 1 https://github.com/supabase/supabase
cd /opt/supabase/docker
cp .env.example .env
```
现在配置文件在 `/opt/supabase/docker/.env`，下一步改它。

### 3.2 生成所需密钥
在服务器上执行这三条，**把输出分别记下来**，下一步要填：
```bash
echo "POSTGRES_PASSWORD = $(openssl rand -hex 24)"
echo "JWT_SECRET        = $(openssl rand -hex 32)"
echo "DASHBOARD_PASSWORD= $(openssl rand -hex 12)"
```

### 3.3 用 JWT_SECRET 生成 ANON_KEY 和 SERVICE_ROLE_KEY
这两个 key 是用上面的 `JWT_SECRET` 签出来的 JWT，**不能随便填**。最稳的办法：
1. 在浏览器打开官方生成器：
   <https://supabase.com/docs/guides/self-hosting/docker#securing-your-services>
   （页面里 "Generate API Keys" 区域）
2. 把你第 3.2 步生成的 `JWT_SECRET` 粘进 **JWT Secret** 输入框。
3. 分别生成 **role = `anon`** 的 key → 这是 `ANON_KEY`。
4. 再生成 **role = `service_role`** 的 key → 这是 `SERVICE_ROLE_KEY`。
5. 两个 key 都复制下来。

> 这两个 key 之后既要填进 Supabase 的 `.env`，也要填进经营舱项目的 `.env.local`（第 6.2 步）。

### 3.4 编辑 Supabase 的 .env
```bash
vi /opt/supabase/docker/.env
```
找到并改成你的值（vi 用法：按 `i` 进入编辑，改完按 `Esc`，输入 `:wq` 回车保存）：

| 配置项 | 改成 |
|---|---|
| `POSTGRES_PASSWORD` | 第 3.2 步的密码 |
| `JWT_SECRET` | 第 3.2 步的 JWT_SECRET |
| `ANON_KEY` | 第 3.3 步的 anon key |
| `SERVICE_ROLE_KEY` | 第 3.3 步的 service_role key |
| `DASHBOARD_USERNAME` | 自定义，如 `admin` |
| `DASHBOARD_PASSWORD` | 第 3.2 步的 DASHBOARD_PASSWORD |
| `SITE_URL` | `https://app.你的域名` |
| `API_EXTERNAL_URL` | `https://api.你的域名` |
| `SUPABASE_PUBLIC_URL` | `https://api.你的域名` |

保存退出。

---

## 第 4 步：启动 Supabase（含 2GB 优化）

### 4.1（可选但推荐）关掉最吃内存的容器
2GB 机器上，`analytics`(日志) 和 `vector` 这两个容器较重且本项目用不到。编辑 compose 文件把它们停用最稳妥的方式是启动后单独停掉（见 4.4），这里先正常启动。

### 4.2 拉取镜像并启动
```bash
cd /opt/supabase/docker
docker compose pull          # 首次较慢，耐心等
docker compose up -d
```

### 4.3 等待并检查状态
```bash
docker compose ps
```
**成功标志**：所有容器 `STATUS` 为 `running` 且 `(healthy)`（首次启动等 1~2 分钟，Postgres 要初始化）。
若某个容器一直 `restarting`，用 `docker compose logs 容器名` 看报错。

### 4.4 ⭐2GB 优化：停掉非必需容器，省内存
确认 Supabase 能跑起来后，停掉用不到的重容器：
```bash
cd /opt/supabase/docker
# analytics(logflare) 和 vector 较吃内存，本项目不需要
docker compose stop analytics vector
```
**验证**：`free -h` 看 `Mem: used` 是否下降。若停掉 analytics 后其他容器报错，再 `docker compose start analytics` 启回来即可。

> Supabase 网关现在监听 `127.0.0.1:8000`，暂不对公网开放，等第 7 步用 Nginx + HTTPS 暴露。

---

## 第 5 步：把项目的数据库结构导入自建库

项目的表结构和 RLS 权限都在 `supabase/migrations/*.sql`。要把它们应用到刚建好的库。

### 5.1 先把项目代码拉到服务器
```bash
cd /opt
git clone <你的仓库地址> jingying-cabin
cd /opt/jingying-cabin
```

### 5.2 用 Supabase CLI 把迁移推到自建库
```bash
# 把 你的POSTGRES_PASSWORD 换成第 3.2 步的密码
pnpm dlx supabase db push \
  --db-url "postgresql://postgres:你的POSTGRES_PASSWORD@127.0.0.1:5432/postgres"
```
**成功标志**：输出 `Applying migration ...` 一条条跑完无报错。

> 备选（CLI 不顺时）：逐个用 psql 按时间顺序应用：
> ```bash
> apt -y install postgresql-client
> DB="postgresql://postgres:你的POSTGRES_PASSWORD@127.0.0.1:5432/postgres"
> for f in supabase/migrations/*.sql; do echo ">> $f"; psql "$DB" -f "$f" || break; done
> ```

### 5.3 创建私有存储桶 `jy-private`
代码默认用名为 `jy-private` 的私有桶上传文件。需要在 Supabase Studio 里建好。
此刻 Studio 还没公网暴露，先用 SSH 端口转发临时访问（在**你自己电脑**新开一个终端执行）：
```bash
ssh -L 8000:127.0.0.1:8000 root@你的服务器公网IP
```
保持这个终端开着，然后浏览器访问 `http://127.0.0.1:8000` →
用第 3.4 步的 `DASHBOARD_USERNAME`/`PASSWORD` 登录 → 左侧 **Storage** → **New bucket** →
名字填 `jy-private`，**Public bucket 保持关闭**（必须私有）→ 创建。
建好后这个临时转发终端可以关掉。

---

## 第 6 步：构建并启动 Next.js 应用

回到服务器上的项目目录 `/opt/jingying-cabin`。

### 6.1 准备环境变量文件
```bash
cd /opt/jingying-cabin
cp .env.production.example .env.local
vi .env.local
```
按下表填（`NEXT_PUBLIC_` 开头的会进前端，浏览器可见；带 service_role 的绝不能加该前缀）：

| 变量 | 填什么 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.你的域名` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 第 3.3 步的 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 第 3.3 步的 service_role key |
| `NEXT_PUBLIC_APP_URL` | `https://app.你的域名` |
| `SUPABASE_PRIVATE_BUCKET` | `jy-private` |

> ⚠️ 变量名是 `SUPABASE_PRIVATE_BUCKET`（代码实际读的就是这个），不是 `.env.example` 里那个旧名 `STORAGE_BUCKET_PRIVATE`。

### 6.2 安装依赖
```bash
pnpm install --frozen-lockfile
```
**成功标志**：输出 `Done in ...s`，无报错。

### 6.3 ⭐构建（2GB 必须限制内存，否则会 OOM）
```bash
# 限制 Node 堆内存为 1.5G，配合 swap 防止构建被系统杀掉
NODE_OPTIONS="--max-old-space-size=1536" pnpm build
```
**成功标志**：最后出现 `✓ Compiled successfully` 和路由列表表格。
> 如果构建中途进程被 Killed（OOM），说明 swap 没生效或内存太紧：
> 先确认 `free -h` 有 4G swap；构建前临时停掉 Supabase 腾内存：`cd /opt/supabase/docker && docker compose stop`，构建完再 `docker compose up -d`。

### 6.4 用 PM2 守护进程启动
```bash
npm i -g pm2
cd /opt/jingying-cabin
pm2 start deploy/pm2/ecosystem.config.js
pm2 save
pm2 startup        # 它会输出一条命令，复制那条命令再执行一次（实现开机自启）
```
**验证**：`pm2 status` 里 `jingying-cabin` 状态为 `online`；
`curl -I http://127.0.0.1:3000` 返回 `HTTP/1.1 200` 或 `307`，说明应用起来了。

---

## 第 7 步：配置 Nginx 反向代理 + HTTPS

### 7.1 拷贝站点模板并替换域名
```bash
cd /opt/jingying-cabin
cp deploy/nginx/app.conf.example /etc/nginx/conf.d/app.conf
cp deploy/nginx/api.conf.example /etc/nginx/conf.d/api.conf
# 把模板里的 your-domain.com 全部替换成你的真实域名
sed -i 's/your-domain.com/你的真实域名/g' /etc/nginx/conf.d/app.conf /etc/nginx/conf.d/api.conf
```

### 7.2 测试并重载 Nginx
```bash
nginx -t          # 必须看到 syntax is ok / test is successful
systemctl reload nginx
```

### 7.3 一键签发 HTTPS 证书
```bash
certbot --nginx -d app.你的域名 -d api.你的域名
```
按提示输入邮箱、同意条款；问是否强制 https 跳转时选 **2（Redirect）**。
**成功标志**：输出 `Congratulations! ... https://app.你的域名`。证书自动续期已由 certbot 定时任务接管，无需手动。

**验证**：浏览器访问 `https://api.你的域名`，能看到 Supabase 返回内容且地址栏是小锁🔒即成功。

---

## 第 8 步：收尾配置与首个账号

### 8.1 确认 Auth 回调地址
检查 `/opt/supabase/docker/.env` 里：
- `SITE_URL=https://app.你的域名`
- `API_EXTERNAL_URL=https://api.你的域名`

若刚才改过，重启使其生效：
```bash
cd /opt/supabase/docker && docker compose up -d
```

### 8.2 创建第一个登录账号
本项目不内置演示账号。用第 5.3 步同样的方式访问 Supabase Studio（或现在直接 `https://api.你的域名`，用 Dashboard 账号登录）→ **Authentication → Users → Add user**，创建一个真实测试账号。

### 8.3 （可选）配置发信邮箱
自建 Supabase 默认不真正发邮件。若需要邮箱验证/找回密码，在 `.env` 里配置 SMTP（可用腾讯企业邮箱），改完 `docker compose up -d`。

---

## 第 9 步：验证清单（逐项打勾）

- [ ] `https://api.你的域名` 能打开，地址栏有🔒
- [ ] `https://app.你的域名/console/projects` 能打开经营 Web
- [ ] 用第 8.2 步账号能登录（验证 Auth + JWT）
- [ ] 能创建项目草稿并发布（验证数据库 + RLS）
- [ ] 能上传文件（验证 Storage 桶 `jy-private`）
- [ ] `pm2 logs jingying-cabin` 与 `docker compose logs` 无明显报错
- [ ] `free -h` 内存没爆（used + swap 有余量）

---

## 第 10 步：日常运维速查

```bash
# —— 应用更新上线 ——
cd /opt/jingying-cabin && git pull
pnpm install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=1536" pnpm build
pm2 reload jingying-cabin

# —— 查看日志 ——
pm2 logs jingying-cabin                       # 应用日志
cd /opt/supabase/docker && docker compose logs -f   # Supabase 日志

# —— 数据库备份（强烈建议设成每日定时任务）——
mkdir -p /opt/backup
docker exec -t supabase-db pg_dump -U postgres postgres > /opt/backup/db_$(date +%F).sql

# —— 重启服务 ——
pm2 restart jingying-cabin
cd /opt/supabase/docker && docker compose restart
```

---

## 常见坑速查

| 现象 | 原因 / 解决 |
|---|---|
| 构建时进程被 `Killed` | 内存不足。确认 4G swap 已生效；构建加 `NODE_OPTIONS="--max-old-space-size=1536"`；必要时先 `docker compose stop` 停 Supabase 再构建 |
| 登录报跨域 / 连不上 Supabase | `NEXT_PUBLIC_SUPABASE_URL` 必须是**公网 HTTPS** 子域名，不能填 `127.0.0.1`；改完要**重新 `pnpm build`**（该变量是构建期注入的） |
| 上传文件失败 | 确认变量名是 `SUPABASE_PRIVATE_BUCKET`，且桶 `jy-private` 已建且为私有 |
| `80/443` 打不开 | 检查腾讯云防火墙是否放行 + 域名是否已备案 |
| Supabase 容器频繁重启 | 多半是内存不足。确认已加 swap，并按 4.4 停掉 `analytics`/`vector` |
| 证书签发失败 | 确认 DNS 已解析到本机、80 端口可达、Nginx 正在运行 |

---

## 内存实在不够时的退路

如果做完上述优化后 2GB 仍频繁 OOM、运行不稳，有两条路：
1. **升级到 4GB**（最简单，自建 Supabase 体验立刻顺畅）。
2. **改用方案 B**：Supabase 用官方云托管，服务器只跑 Next.js（内存占用骤降到几百 MB）。代价是数据存在 Supabase 云而非你的服务器。需要的话我再给你方案 B 的教程。
