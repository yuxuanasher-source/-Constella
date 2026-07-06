# 阶段 0 整改计划(基于 2026-07-06 技术审计)

目标:把审计中 6 个 P0 缺口收敛到零,P1 项同步跟进,最终按 G1→G4 顺序通过验收压测。
原则:**先底线(备份/监控),再止血(内存/尺寸),最后动架构(CDN 迁移)**——前两步不依赖任何架构决策,当天就能开工;架构迁移改动面最大,放最后且有过渡方案兜底。

## 里程碑总览

| 里程碑 | 内容 | 工期 | 退出条件 |
|---|---|---|---|
| M1 底线止血 | 备份+恢复演练、监控告警、并发配置固化、服务器基线 | 第 1–2 天 | C1/C2/E1 转绿;B3/D1/D4/C3/F2 运维项闭环 |
| M2 解析链路加固 | 流式抽音频、尺寸校验、配额拦截、队列面板 | 第 3–5 天 | B2/F3/E2/B5 转绿;G1 压测前置就绪 |
| M3 播放架构迁移 | 录屏迁 COS+CDN、faststart、直传 | 第 6–10 天 | A1/A2/A3/A4/B1 转绿 |
| M4 验收压测 | G1–G4 四个实验 | 第 10–11 天 | 全部通过 = 阶段 0 达标 |

需要在开工前拍板的 4 个决策点见文末。

---

## M1 底线止血(第 1–2 天)

### R1|C1 数据库每日自动备份 —— 开发 0.5 天 + 运维 0.5 天

**新增 `scripts/backup.sh`**(仿照 deploy.sh 的 docker exec 模式):
1. `docker exec supabase-db pg_dump -U postgres -d postgres -Fc` → `/var/backups/jingying-cabin/db-$(date +%Y%m%d).dump`;
2. 校验产物大小(低于阈值如 1MB 即视为失败);
3. 用 `cos-nodejs-sdk-v5`(项目已有依赖)或 coscmd 上传到**独立备份桶**(建议异地域,如 ap-shanghai;不要复用 `jy-private-1322741645`);
4. 本地滚动保留 3 天,COS 桶配 14 天+ 生命周期规则;
5. 失败时 curl 企微机器人 webhook 告警;
6. crontab:`0 3 * * * bash /var/www/jingying-cabin/scripts/backup.sh >> /var/log/jy-backup.log 2>&1`。

**验收(=清单 C1)**:连续 3 天在 COS 控制台看到 dump 文件且大小合理。

### R2|C2 恢复演练 —— 运维 0.5 天

写成 runbook(`docs/runbooks/db-restore.md`):干净机器/容器起一个空 PG → `pg_restore -U postgres -d postgres --clean --if-exists` → 起应用指向恢复库 → 验证登录、组织/主播/结算关键表行数与生产一致。**做一次真实演练并留屏录**。
备注:`jy-private` 桶内的录屏/截图对象目前在本机 docker volume,不在本备份范围——对象级容灾在 M3 迁 COS 后由桶版本控制+跨地域复制解决(见决策点 3)。

### R3|E1 拨测端点 + 四条核心告警 —— 开发 0.25 天 + 运维 0.25 天

**开发**:新增 `app/api/health/route.ts`——用 admin client 执行一次轻查询(如 `organizations` 表 `select id limit 1`),返回 `{ ok, db: true|false }`;DB 挂时返回 503。不带鉴权(供拨测),不泄漏任何业务数据。
**运维**:装腾讯云可观测平台 Agent;控制台配четыре告警推企微/手机——①内存 >85% ②磁盘 >80% ③公网带宽 >80% ④拨测 `/api/health` 非 200。
**验收(=E1)**:`stress-ng --vm` 占内存一次,告警 5 分钟内到手机。

### R4|B3 并发闸门配置固化 —— 运维 0.25 天

- 生产 env 显式写入 `RECORDING_AI_INLINE_KICK_LIMIT=1`(默认值也写明,防止将来误改);
- crontab 调 runner 时显式传 limit=3(把总并发压回安全线 3–4):
  `*/2 * * * * curl -s -X POST -H "Authorization: Bearer $RECORDING_AI_RUNNER_TOKEN" -H "Content-Type: application/json" -d '{"limit":3}' http://127.0.0.1:3000/api/internal/recording-ai/run`
- `pm2 describe jingying-cabin` 确认 `exec_mode: fork`、`instances: 1`(inline 闸门是进程内计数,cluster 模式会翻倍);
- 顺带核对各 runner token 均为 ≥32 字节随机串(D2 运维项)。

**验收(=B3/D2)**:出示环境变量清单(值打码)+ crontab 行。

### R5|D1/D4/C3 服务器与存储基线 —— 运维 0.5 天

- 公网 `nmap -p 22,80,443,3000,5432,8000,54321-54324 <IP>`:除 80/443/SSH 外全关(D1:5432 与 Supabase Kong/Studio 端口必须扫不到);
- UFW/安全组白名单化;SSH 禁密码、仅密钥;`unattended-upgrades` 开启(D4);
- COS:备份桶与知识库桶开**版本控制**;新建 CAM 子账号只授予这两个桶的读写,替换生产 env 中复用的 OCR 主密钥——代码已支持专用密钥优先(`lib/config/env.ts:72-73` 先读 `TENCENT_COS_SECRET_ID/KEY`),**零代码改动,纯配置**(C3);
- 腾讯云费用告警:月账单 >¥2,500 通知;CDN/COS 用量单独设告警(F2)。

---

## M2 解析链路加固(第 3–5 天)

### R6|B2a 流式抽音频,消灭整片进内存 —— 开发 1 天(⭐ 本组核心)

改造 `features/recordings/recording-audio-extraction.ts`:
1. 删除 `client.storage.download()` + `Buffer.from(await data.arrayBuffer())`(83 行,OOM 根因);
2. 改为 `createSignedDownloadUrl`(`features/storage/private-upload.ts` 已有)拿 1h 签名 URL → `fetch` 响应体用 `stream/promises` 的 `pipeline` 流式写入 `workDir/input`,内存峰值从 O(文件大小) 降到 O(64KB);
3. 落盘后先跑 `ffprobe -show_entries format=duration,size`:超过时长/大小闸门(env:`RECORDING_MAX_DURATION_MINUTES`、`RECORDING_MAX_FILE_BYTES`,取值见决策点 2)→ 抛明确中文错误走既有回退(B6 链路原样复用);
4. 现有 finally 清理、80MB 音频闸门、测试注入点(`runCommand`/`extractAudio`)全部保留;签名 URL 的获取做成可注入参数,单测 mock fetch。

好处:同时治好 B5 的隐患(OOM kill 导致 tmp 残留)和 G1 压测的内存风险;且与 M3 迁 COS 天然兼容(届时只换签名 URL 的来源)。

### R7|B2b 上传侧尺寸强制 —— 开发 1 天 + 运维 0.25 天

1. **新迁移** `lower_private_bucket_limit.sql`:`jy-private` 桶限 2GB → 314572800(300MB,或决策点 2 定的值);运维同步调 storage 容器 `FILE_SIZE_LIMIT` env(20260705 迁移注释里已提醒过此手工项);
2. `app/api/uploads/signed/route.ts`:请求体增加 `fileSizeBytes` 申报字段,超限直接 400 + 中文提示(快速失败;真正强制靠桶限,申报绕不过桶);
3. 前端(`streamer-desktop-reference.jsx:3985`、`streamer-mobile-reference.jsx:5003` 两处上传入口):选文件后校验 `file.size`,超限就地提示,不发起上传;
4. 入队解析(`app/api/recording-assets/[assetId]/ai-analysis/route.ts`)前用 storage `info()` 查对象实际大小,超限拒绝——防旧存量大文件进解析队列。

**验收(=B2)**:传 1GB 文件 → 前端提示 + 桶层拒绝;入队超大存量资产 → 明确报错。

### R8|F3 解析配额拦截 —— 开发 0.5 天

`ai-analysis` POST 入队前:`select count(*) from recording_ai_analyses where organization_id = ? and created_at >= 本月一日`,≥ `RECORDING_AI_MONTHLY_QUOTA`(env,默认 100)→ 429 + 文案「本月解析额度已用完」;前端展示剩余额度。超限行为(硬拒 vs 引导加购)见决策点 4。
**验收(=F3)**:测试组织打满后第 101 条被拦。

### R9|E2 队列健康可见 —— 开发 0.5 天

新增 `app/api/internal/recording-ai/queue-health/route.ts`(Bearer 复用 `RECORDING_AI_RUNNER_TOKEN`):返回 queued/running 数、24h failed 数与失败率、最老 queued 等待分钟数。运维 crontab 每 10 分钟拉取,失败率 >10% 或最老等待 >30 分钟 → 企微告警(接 R3 通道)。
**验收(=E2)**:演示查询 + 人为触发一次失败率告警。

### R10|B5/E3 环境固化 —— 运维 0.5 天

ffmpeg 固定版本(apt-mark hold 或静态二进制 + `RECORDING_AI_FFMPEG_PATH`);连跑 10 条解析后 `du -sh /tmp/recording-audio-*` 应为空(R6 后 OOM 残留风险已消除)。`pm2 startup` + `pm2 save` 配好开机自启;supabase 各容器 `restart: always`;现场 kill 进程 + 重启机器各演练一次(E3)。

---

## M3 播放与上传架构迁移(第 6–10 天)

### 方案选择(决策点 1)

| | 甲:录屏迁 COS + CDN(**推荐**) | 乙:CDN 回源本机(过渡) |
|---|---|---|
| A1 字节离机 | ✅ 彻底 | ◐ 仅缓存命中部分;录屏低复用,命中率低 |
| B1 内网拉片 | ✅ 同地域 COS 内网端点免费 | ✅(本机不变) |
| A4 直传 | ✅ PostObject 直传 COS | ❌ 仍打本机 |
| 对象容灾 | ✅ 版本控制+跨地域复制 | ❌ 仍在本机 volume |
| 工作量 | 开发 2–3 天 + 运维 0.5 天 | 运维 0.5 天 |

乙只作为甲上线前的应急垫,不建议作为终态。以下按甲展开。

### R11|A1/A2/A4/B1 录屏迁 COS+CDN —— 开发 2–3 天 + 运维 0.5 天

**运维先行**:CDN 加速域名绑定私有桶(回源服务授权),开启 **Type-A URL 鉴权**,过期 1 小时,HTTPS 证书;服务器与桶同地域(ap-guangzhou)以启用内网端点。

**开发**(302 架构不动,只换两端的签名来源):
1. 迁移:`recording_asset_sources` 加 `storage_provider` 列(`'supabase'|'cos'`,默认 supabase),存量行不动;
2. 上传:`uploads/signed` 对 `category=recordings` 改签 **COS PostObject 预签名**,policy 带 `content-length-range 0~300MB`——把 R7 的上传强制做成协议级(比桶限更硬),截图类目暂留 Supabase;
3. 下载:`download/route.ts` 按 provider 分支——`cos` → 生成 CDN Type-A 鉴权 URL 302;`supabase` → 现状。鉴权+组织隔离逻辑(65-88 行)原样保留;
4. worker:R6 已改为「签名 URL + 流式」,按 provider 换成 COS **内网端点**签名 URL 即可(B1 达标,拉片零公网流量零费用);
5. 存量迁移脚本 `scripts/migrate-recordings-to-cos.mjs`:遍历 Supabase 桶 recordings 前缀 → 流式搬运到 COS → 校验 ETag/大小 → 更新行 provider;低峰分批跑,可断点续跑;全部迁完前两条路径并存,随时可回退。

**验收(=A1/A2/A4/B1)**:播放/上传期间本机带宽曲线平;播放链接 1 小时后失效、去签名参数 403;解析期间公网无下载尖峰、COS 账单无外网下行。

### R12|A3 faststart 转封装 —— 开发 0.5–1 天

上传登记完成后异步触发一次 remux:`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`(纯改封装不转码,215MB 约十几秒 CPU),回写存储替换原对象;复用 inline-kick/cron 的队列模式控制并发为 1。存量热门录屏跑一次批处理。若迁 COS 后想省本机 CPU,可改用数据万象转码(按量计费,见 F 组预算)。
**验收(=A3)**:15 分钟录屏首帧 <3 秒、拖动中段立即续播。

---

## M4 验收压测(第 10–11 天,=清单 G)

前置核对:R1–R12 全部转绿;监控面板开着录屏。

1. **G1 解析并发**:一次入队 12 条 215MB → 预期按 3 并发消化、≤1 小时全完成、内存峰值 <85%(R6 后单条驻留仅 ffmpeg 工作集);
2. **G2 播放并发**:5 设备各播不同录屏 + 1 条解析在跑 → 播放流畅、本机带宽平(字节走 CDN);
3. **G3 断电演练**:压测中强制重启 → 5 分钟内服务自动恢复(R10 的 pm2 startup),跑一半的解析 15 分钟内被 stale 回收捡回(代码已达标,B4);
4. **G4 恢复演练**:从昨日备份拉起完整系统(R2 的 runbook 复跑)。

---

## 任务总表

| 任务 | 对应清单 | 角色 | 工期 | 里程碑 |
|---|---|---|---|---|
| R1 备份脚本+cron+COS | C1 | 开发+运维 | 1 天 | M1 |
| R2 恢复演练 runbook | C2 | 运维 | 0.5 天 | M1 |
| R3 health 端点+四告警 | E1 | 开发+运维 | 0.5 天 | M1 |
| R4 并发配置固化 | B3/D2 | 运维 | 0.25 天 | M1 |
| R5 端口/SSH/CAM/账单告警 | D1/D4/C3/F2 | 运维 | 0.5 天 | M1 |
| R6 流式抽音频+时长闸门 | B2/B5 | 开发 | 1 天 | M2 |
| R7 上传尺寸强制(四层) | B2 | 开发+运维 | 1 天 | M2 |
| R8 解析配额拦截 | F3 | 开发 | 0.5 天 | M2 |
| R9 队列健康端点+告警 | E2 | 开发 | 0.5 天 | M2 |
| R10 ffmpeg/pm2 固化+演练 | B5/E3 | 运维 | 0.5 天 | M2 |
| R11 录屏迁 COS+CDN | A1/A2/A4/B1 | 开发+运维 | 3 天 | M3 |
| R12 faststart 转封装 | A3 | 开发 | 1 天 | M3 |
| G1–G4 验收压测 | G | 全员 | 1 天 | M4 |

合计:开发约 7–8 人天,运维约 3 人天,日历工期约 2 周(M1/M2 可并行抢进度)。

## 开工前需拍板的 4 个决策点

1. **是否采用方案甲(迁 COS+CDN)**——推荐甲;若暂缓,A1/A2/A4/B1 无法达标,G2 压测必挂,只能接受"小规模内测不达标上线"的风险并写入例外清单;
2. **单片上限取值**:清单口径是 15 分钟/300MB(整套并发测算的前提);若业务上确需整场直播(2–3 小时),上限、并发数、内存水位要一起重算——R6/R7 的闸门全部走 env,改数字不改代码;
3. **录屏对象容灾等级**:迁 COS 后是否加跨地域复制(成本↑,RPO↓);不迁则需另行设计本机 volume 的对象备份;
4. **配额超限行为**:硬拒(最简单)还是引导加购(billing 已有加量包/软超额概念,`features/billing/usage-metering.ts`,工作量 +1–2 天)。

---

*本计划基于分支 `claude/technical-audit-checklist-o6z4zv` 的审计报告(`docs/reports/2026-07-06-technical-audit-checklist.md`);所有整改任务的验收标准即审计清单对应编号的「怎么验证」列。*
