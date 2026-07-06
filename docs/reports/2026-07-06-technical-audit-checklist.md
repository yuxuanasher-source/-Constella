# 技术 / 代码 / 功能审计报告(阶段 0 上线清单)

日期:2026-07-06
范围:代码仓库静态审计 + 单元测试佐证。凡涉及生产服务器、云控制台、网络拓扑的检查项,标注为「运维现场验证」,本报告只给出代码侧结论与验证方法。
测试佐证:`pnpm vitest run features/recordings features/storage app/api/uploads app/api/recording-assets features/ai/inline-kick-gate.test.ts features/ai/invocation-ledger.test.ts` → 23 files / 131 tests 全部通过。

## 结论速览

**先说清一个前提:清单 A1/A2/B1 假设"录屏字节在腾讯云 COS + CDN",但代码现状不是。**
录屏文件存储在**自托管 Supabase Storage**(`jy-private` 桶,与应用同一台服务器,见 `scripts/deploy.sh` 的单机部署形态);腾讯云 COS 目前只用于知识库 JSON 持久化(`lib/storage/tencent-cos.ts` 仅有 getJson/putJson),**没有任何视频对象进 COS,也没有 CDN 层**。因此播放/上传/解析的所有字节最终都从这台服务器进出——这是本次审计最大的结构性结论。

| # | 检查项 | 代码侧结论 | 级别 |
|---|---|---|---|
| A1 | 播放字节不过服务器 | ❌ **不达标**(302 架子已就位,但跳转目标是本机 Supabase,不是 CDN/COS) | P0 |
| A2 | CDN 私有内容鉴权 | ❌ **前提不成立**(无 CDN;1 小时签名过期语义由 Supabase 承担) | P0 |
| A3 | 视频可秒开可拖动 | ❌ **无保障**(无 faststart/转封装链路;Range 依赖 Supabase,需实测) | P0 |
| A4 | 上传直传不过机 | ◐ 部分(签名直传绕开了 Next 进程,但目标仍是本机存储) | P1 |
| B1 | 解析下载走内网 | ◐ 部分(同机下载,无公网下行;但取决于域名解析路径,需确认) | P0 |
| B2 | 单条片子尺寸受控 | ❌ **不达标**(桶限被提到 2GB,无业务校验;整片进内存) | P0 |
| B3 | 并发闸门配置正确 | ◐ 代码达标(inline 默认 1,claim 默认 5 上限 10);生产环境变量与 crontab 需运维出示 | P0 |
| B4 | 队列自愈生效 | ✅ 达标(15 分钟 stale 回收 + 乐观锁 + 耗尽落盘 failed,测试覆盖) | P1 |
| B5 | ffmpeg 环境就绪 | ◐ 部分(路径可配、临时目录 finally 清理;版本固定与实机安装需运维验证) | P1 |
| B6 | 降级路径可用 | ✅ 达标(未配置→null→确定性草稿;ASR degraded→回退;流水线抛错→回退+标注) | P1 |
| C1 | 数据库每日自动备份 | ❌ **不达标**(仓库内零备份脚本/配置/文档) | **P0 第一优先** |
| C2 | 备份能恢复 | ❌ 不达标(被 C1 阻塞) | P0 |
| C3 | COS 数据不可误删 | 🔍 运维出示;代码侧发现密钥复用问题(见 D2 备注) | P1 |
| D1 | 数据库不暴露公网 | 🔍 运维现场验证(端口扫描) | P0 |
| D2 | 内部接口有强口令 | ✅ 代码达标(无 token 一律 401;仓库密钥扫描零命中;.env 全部忽略) | P0 |
| D3 | 组织隔离 | ✅ 代码达标(404/403 双层校验 + 全表 RLS);建议现场再实测一次 | P0 |
| D4 | 服务器基线加固 | 🔍 运维出示 | P1 |
| E1 | 四条核心告警 | ❌ **不达标**(无任何监控/告警集成,连拨测用的 health 端点都没有) | P0 |
| E2 | 队列健康可见 | ❌ 不达标(无队列面板/查询端点) | P1 |
| E3 | 进程守护 | ◐ 部分(deploy.sh 集成 pm2/systemd 重启;开机自启需现场演练) | P1 |
| F1 | AI 花费可见 | ✅ 代码达标(invocation ledger 记 costCents,按场景/供应商/天汇总,有面板) | P1 |
| F2 | 云账单告警 | 🔍 运维出示 | P1 |
| F3 | 解析配额执行 | ❌ 不达标(用量有记录,但 AI 指标是软超额,入队无拦截,第 101 条照跑) | P1 |

P0 共 12 项:代码侧达标 2(D2/D3),部分达标 3(B1/B3 + A1 的路由结构),**不达标 6(A1/A2/A3/B2/C1/C2/E1 中除 A1 结构外)**,纯运维验证 1(D1)。

---

## A. 播放与带宽

### A1 播放字节不过服务器 —— ❌ P0

**已做对的部分**:播放端点只做鉴权 + 302,不代理字节。
- `app/api/recording-assets/[assetId]/download/route.ts:123` — `NextResponse.redirect(signed.signedUrl, 302)`,注释明确 "no byte proxying here"。

**不达标的部分**:签名 URL 由 Supabase Storage 生成,域名是 `NEXT_PUBLIC_SUPABASE_URL`:
- `features/storage/private-upload.ts:40-55` — `client.storage.from(bucket).createSignedUrl(...)`;
- `lib/db/supabase-server.ts` — admin client 用 `NEXT_PUBLIC_SUPABASE_URL` 构造。

自托管 Supabase 与应用同机(`scripts/deploy.sh`:`DB_CONTAINER=supabase-db`、`APP_DIR=/var/www/jingying-cabin`),所以**播放字节仍从这台服务器的网卡流出**。播放期间带宽监控曲线不可能是平的;5 路并发播放(清单 G2)大概率打满小水管带宽。

**整改方向**(二选一):
1. 录屏对象迁到 COS,download 路由改签 COS/CDN URL(302 结构不用动,只换签名来源);
2. 保留 Supabase 存储,前面加 CDN 回源本机 + URL 鉴权。

### A2 CDN 私有内容鉴权 —— ❌ 前提不成立,P0

无 CDN,Type-A/D 鉴权无从谈起。现状的等价语义:签名 URL 过期 1 小时(`download/route.ts:118`,`expiresInSeconds: 3600`),过期/去签名后由 Supabase storage-api 拒绝——这个行为是 Supabase 内置的,代码侧无问题,但**过期拒绝、去参拒绝两条仍需现场实测**。A1 整改后此项要按 CDN 鉴权重新验收。

### A3 视频可秒开可拖动 —— ❌ 无代码保障,P0

- 全仓库无 `faststart` / `moov` / fMP4 处理:上传文件原样入桶,ffmpeg 只用于抽音频(`recording-audio-extraction.ts:100-114`),没有任何转封装步骤。**moov 是否前置完全取决于主播上传的原始文件**(OBS 默认 mp4 录制 moov 在尾部,风险真实存在)。
- Range 请求:无自建流媒体端点,依赖 Supabase storage-api 对签名 URL 的 Range 支持——需现场用 15 分钟录屏实测「首帧 <3 秒 + 拖动续播」。
- 播放器是原生 `<video controls autoPlay>`(`components/reference-ui/ops-reference.jsx:15532、16425`),无特殊处理。

**整改方向**:上传完成后异步跑一次 `ffmpeg -movflags +faststart` 重封装(或在解析 worker 里顺带做),否则此项只能靠约束主播录制工具。

### A4 上传直传 —— ◐ P1

签名直传已实现(`app/api/uploads/signed/route.ts` → `createSignedUploadUrl`,`private-upload.ts:24-38`),字节不过 Next.js 进程;路径清洗(组织/类目/属主/文件名)有白名单校验(`private-upload.ts:57-93`)。但上传目标是同机 Supabase storage,**入站带宽仍打在本机**。200MB 上传时服务器入站曲线必有尖峰——单机架构下该项测不平,迁 COS 直传后才能达标。

---

## B. AI 解析链路

### B1 解析下载走内网 —— ◐ P0

worker 拉原片走 `client.storage.from(bucket).download(path)`(`recording-audio-extraction.ts:73-75`),端点同样是 `NEXT_PUBLIC_SUPABASE_URL`。因为存储就在本机,**不存在 COS 外网下行费用**(根本不经 COS),这一点天然满足;但「无公网带宽尖峰」取决于该域名从服务器自身解析出去的路径:
- 若走 nginx 回环 → 达标;
- 若 DNS 解析到公网 IP 且未做 hairpin 优化 → 可能计公网流量。

**运维验证**:在服务器上 `curl -sI $NEXT_PUBLIC_SUPABASE_URL` 看路由,必要时 `/etc/hosts` 固定 127.0.0.1;再按清单方法看解析期间公网带宽曲线。

### B2 单条片子尺寸受控 —— ❌ P0

三处证据叠加,这是解析链路最危险的一项:

1. **桶限被特意放大到 2GB**:`supabase/migrations/20260705090000_raise_private_bucket_limit.sql` 把 `jy-private` 从 50MB 提到 2147483648,注释明说"支撑整段直播录屏原始文件上传",且提醒容器级 `FILE_SIZE_LIMIT` 也要同步调大。
2. **无任何业务侧校验**:`app/api/uploads/signed/route.ts` 的请求体只有 category/ownerId/fileName,不收也不校验大小/时长/码率;1GB 文件不会被拒,更不会有"明确提示"。
3. **整片进内存**:`recording-audio-extraction.ts:83` — `Buffer.from(await data.arrayBuffer())` 把原片完整读进 Node 堆再落盘。2GB 原片 × 并发 3-4 路,配合 deploy.sh 提到的小内存服务器(构建都要 3GB 堆 + swap),**OOM 几乎必然**。唯一的闸门是抽出的音频 >80MB 才报错(`recording-audio-extraction.ts:16,123-127`,约 3.5 小时时长)——但那时原片早已驻留内存,闸门在错误的位置。

**整改方向**(按优先级):
1. 抽音频改为流式:用签名 URL 让 ffmpeg 直接读(或流式落盘临时文件),消除 `arrayBuffer()` 整片驻留——这是治本;
2. 上传侧加业务校验:入队/上传登记时校验时长 ≤15 分钟、大小 ≤300MB,超限拒绝并给中文提示;
3. 桶限回调到与业务上限一致(如 500MB),不要留 2GB 敞口。

### B3 并发闸门 —— ◐ 代码达标,配置待出示,P0

- inline kick 默认 1,可用 `RECORDING_AI_INLINE_KICK_LIMIT` 覆盖,0 = 关闭(`recording-ai-instant-run.ts:16`,`inline-kick-gate.ts:38-51`);闸门满时跳过、留给 cron,绝不内存排队(`inline-kick-gate.ts` 注释与实现一致,有测试)。
- cron 认领默认 5、硬上限 10(`recording-ai-analysis.ts:564-565`;`app/api/internal/recording-ai/run/route.ts:78-81` 对 body.limit 做了 1..10 钳制)。
- **两个运维确认点**:① 生产 crontab 调 `/api/internal/recording-ai/run` 时传的 limit(≤5)与调用频率——crontab 不在仓库内;② pm2 必须是单 fork(闸门是进程内计数,`inline-kick-gate.ts:3-5` 注释已声明前提);若误配 cluster 模式,inline 并发 = 实例数 × limit。
- 注意默认组合的理论最大并发 = cron 5 + inline 1 = 6,高于清单安全线 3-4;建议生产显式设 crontab limit=3。

### B4 队列自愈 —— ✅ P1

`claimAndRunRecordingAiAnalyses`(`recording-ai-analysis.ts:588-743`)完整实现:
- 15 分钟超时(`RECORDING_AI_CLAIM_TIMEOUT_MS`,566 行);
- queued 行乐观锁认领(`status='queued'` 条件更新,762-781);stale running 行重认领用 `claimed_at < cutoff` 做二次锁(790-811),不会被偷两次;
- attempt 耗尽的 stale 行落盘 failed 并写 `error_summary`(819-844),**不会永远卡在"运行中"**;
- 单条失败只进 failures,不拖垮批次(734-739)。
现场杀进程演示仍建议做(验证 cron 真在跑),但代码逻辑与测试均已覆盖。

### B5 ffmpeg 环境 —— ◐ P1

- 路径可配:`RECORDING_AI_FFMPEG_PATH`,缺省 PATH 中 `ffmpeg`(`recording-audio-extraction.ts:45-49`);未安装时报错信息明确指向该变量(150-153)。
- 临时目录:每任务独立 `recording-audio-<uuid>`,`finally` 中强制 `rm -rf`(134-136),ffmpeg 失败也清理 ✅。
- **缺口**:进程被 OOM killer 直接杀死时 finally 不执行,tmp 会残留大文件——与 B2 耦合,B2 治好后此风险大幅下降。版本固定、实机安装、连跑 10 条后 tmp 归零仍需运维验证。

### B6 降级路径 —— ✅ P1

- ASR 未配置或无真实 LLM provider → 流水线工厂直接返回 null → runner 走确定性草稿(`recording-ai-pipeline.ts:129-165`);
- ASR 返回 degraded → 流水线返回 null 回退(266-268);
- 流水线抛错 → 回退草稿并在 riskFlags 里标注"AI 转写分析不可用,已回退基础分析"(`recording-ai-analysis.ts:868-884`),**任务本身完成而非失败**。
填错 ASR 密钥的现场演练可直接按清单做,代码行为已有测试背书。

---

## C. 数据安全与备份

### C1 每日自动备份 —— ❌ P0(全清单第一优先)

**仓库内没有任何备份实现**:无 pg_dump 脚本、无备份 cron、无上传 COS 的逻辑、docs 里无备份文档;`scripts/deploy.sh` 只管部署不管备份。若服务器上有仓库外的 crontab,需运维出示;从代码库视角此项为零。

**整改建议**(一个下午可完成):加 `scripts/backup.sh` — `docker exec supabase-db pg_dump -U postgres -Fc` + `coscmd upload`(异地桶)+ 保留 14 天滚动清理 + crontab 每日执行;同时把 `jy-private` 桶内录屏文件纳入备份策略讨论(体积大,至少做桶级版本控制)。

### C2 恢复演练 —— ❌ P0

被 C1 阻塞。C1 落地后按清单在干净环境演练一次 `pg_restore` 并验证登录/数据完整。

### C3 COS 不可误删 —— 🔍 P1

桶版本控制/删除保护是控制台配置,需运维出示截图。**代码侧发现**:COS 密钥直接复用 OCR 的 `TENCENT_SECRET_ID/KEY`(`lib/config/env.ts:72-73`),一把密钥同时具备 OCR 与 COS 权限,不满足"最小权限"——建议为 COS 拆专用子账号密钥,只授予目标桶读写。

---

## D. 安全与权限

### D1 PG 不暴露公网 —— 🔍 P0

生产库是 docker 容器 `supabase-db`(deploy.sh),端口映射不在仓库内。按清单现场端口扫描验证(`nmap -p 5432,8000,54321-54324 <公网IP>`);`supabase/config.toml` 只是本地开发配置,不能作为生产证据。

### D2 内部接口强口令 —— ✅ P0(代码侧)

- runner 鉴权:`app/api/internal/recording-ai/run/route.ts:11-17` — **未配置 `RECORDING_AI_RUNNER_TOKEN` 时一律 401**(`!expected` 短路,不存在"没配就裸奔"),Bearer 严格匹配;错误消息经 `sanitizeRunnerMessage` 脱敏(120-127)。
- 密钥扫描:全仓库(含 git 历史)按 `sk-*`/`AKID*`/JWT/硬编码 SECRET 模式扫描零命中;`.gitignore` 忽略 `.env*` 仅保留 `.env.example`(全为空占位符);git 历史从未提交过 env 文件。
- **运维项**:生产 token 是否为长随机串(≥32 字节)需出示环境变量清单核对(值可打码,看长度即可)。同批还有 `OCR_RUNNER_TOKEN`、`ANOMALY_RUNNER_TOKEN`、`ACCOUNT_LIBRARY_RUNNER_TOKEN`、`ADMISSION_RUNNER_TOKEN`、`BILLING_CRON_SECRET` 等,应一并核对。

### D3 组织隔离 —— ✅ P0(代码侧,建议实测)

- 下载路由:service role 查资产后手动校验 `organization_id !== context.auth.organizationId → 404`(`download/route.ts:65-70`);非 MCN staff 且非资产属主 → 403(73-88)。
- runner 侧同样有 org 校验(`recording-ai-analysis.ts:524-526`,认领后再验 716-722)。
- 业务表全量启用 RLS(`supabase/migrations/20260601161000_initial_foundation.sql:801+`)。
按清单用 A 组织账号实测 B 组织资产 ID 一次即可闭环。

### D4 服务器基线 —— 🔍 P1

防火墙/SSH/自动更新均为服务器配置,运维出示。

---

## E. 监控与告警

### E1 四条核心告警 —— ❌ P0

代码库无任何监控集成:无 `/api/health` 拨测端点、无内存/磁盘/带宽上报、无企微/手机推送通道。四条告警(内存 >85%、磁盘 >80%、公网带宽 >80%、拨测)全部缺失。
**整改建议**:① 加一个极简 `app/api/health/route.ts`(查一次 DB 返回 200)供拨测;② 服务器装腾讯云监控 Agent 并在控制台配四条告警推企微——半天工作量,但没有它,B 组的全部并发测算等于裸奔。

### E2 队列健康可见 —— ❌ P1

`recording_ai_analyses` 表有 status/attempt/claimed_at 完整字段,但**没有任何端点或面板暴露排队数/失败数/最老等待时长**;`/api/ai/usage`(AI 用量面板)只汇总调用次数与成本,不含队列健康。失败率告警更无从谈起。整改:加一个内部只读端点(按 status 聚合 + min(created_at)),接入 E1 的告警通道。

### E3 进程守护 —— ◐ P1

`deploy.sh` 尾部集成 pm2 restart / systemctl restart(两种守护形态都支持)。**运维验证**:`pm2 startup` 是否已配置(机器重启后 pm2 自身要能起来)、supabase docker 是否 `restart: always`;按清单现场 kill + 重启机器各演示一次。

---

## F. 成本护栏

### F1 AI 花费可见 —— ✅ P1(代码侧)

- 每次 ASR 调用按时长折算成本入台账:0.8 元/小时 → costCents(`recording-ai-pipeline.ts:41-42,250-255`);LLM 调用回传 costCents 一并入账(323-343);台账即 `ai_invocations` 表(`features/ai/invocation-ledger.ts`)。
- 汇总能力:`features/ai/ai-usage-overview.ts` 按场景/供应商/日聚合 costCents,有 `/api/ai/usage` 接口与 `ai-usage-dashboard.jsx` 面板。
- 月度对照 ¥1,000 预算属日常运营动作,拉面板即可。

### F2 云账单告警 —— 🔍 P1

腾讯云控制台配置,运维出示截图。

### F3 解析配额执行 —— ❌ P1

- 有记录、无拦截:每次 AI 调用写 `usage_events`(metric="ai",`invocation-ledger.ts:98-105`),但硬阻断名单只有 OCR(`features/billing/usage-metering.ts:30`,`HARD_BLOCK_METRICS = ["ocr"]`),AI 为 5% 软超额;
- 入队路由(`app/api/recording-assets/[assetId]/ai-analysis/route.ts` POST)在 `requestRecordingAiAnalysis` 前**没有任何配额检查**——测试组织打满 100 条后,第 101 条照常入队照常消耗 ASR/LLM 费用。
**整改**:入队前查当月 `usage_events` 聚合(或把递交解析记为独立 metric),超额返回 402/429 与明确文案;或把该 metric 加入 HARD_BLOCK_METRICS。

---

## G. 上线前验收压测 —— 全部待做,且有两项会被现状直接卡住

| 实验 | 依赖项现状 | 预判 |
|---|---|---|
| G1 解析并发(12 条 215MB) | B2 ❌ 整片进内存 | 215MB × 4 并发 ≈ 0.9GB 仅原片驻留,加 Node 堆/ffmpeg,小内存机大概率触发 OOM 或 swap 卡死。**先修 B2 再压**,否则测的是事故不是容量 |
| G2 播放并发(5 路 + 1 解析) | A1 ❌ 字节走本机 | 5 路 1080p ≈ 10-20Mbps 出站,叠加解析,小带宽服务器必卡。**A1 不整改此实验无法通过** |
| G3 断电演练 | B4 ✅ / E3 ◐ | 代码侧就绪;取决于 pm2 startup + docker restart 策略是否配好 |
| G4 恢复演练 | C1 ❌ | 被备份缺失阻塞,C1 是先决 |

## 建议的整改顺序(P0 收敛路径)

1. **C1/C2 备份 + 恢复演练**(半天,零代码风险,底线优先);
2. **B2 流式抽音频 + 上传业务限制**(治 OOM,是 G1 的前提);
3. **E1 health 端点 + 云监控四告警**(半天,是一切压测的观测前提);
4. **A1/A2 录屏迁 COS+CDN 或 CDN 回源**(工作量最大,决定 G2 成败;302 路由结构已就位,只换签名来源,改动面可控);
5. A3 faststart 转封装、F3 配额拦截、E2 队列面板随后跟进;
6. 全部落地后按 G1→G4 顺序做验收压测。

---

*审计方法说明:本报告基于分支 `claude/technical-audit-checklist-o6z4zv`(基线 commit 9b41758)的代码静态审查,所有文件行号以该版本为准;「运维现场验证」项无法从仓库判断,已给出具体验证命令/方法。*
