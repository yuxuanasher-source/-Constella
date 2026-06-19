# 部署分支（codex/full-project-ui）实战问题清单（2026-06-19）

配套:`docs/reports/2026-06-18-comprehensive-code-audit.md`、`docs/reports/2026-06-18-remediation-plan.md`

## 背景与适用范围

原始综合审计针对的是 `claude/comprehensive-code-audit-t3qjkv`（≈ `codex/ai-runtime-foundation` + 审计文档）。但**线上生产环境**（`134.175.123.50:3000`，自托管 Supabase + pm2 `next start`）实际部署的是 **`codex/full-project-ui`** 分支——它比被审计分支显著更完整(含结算规则编辑器、项目财务设置、计费门控接入、可用的 Tencent OCR worker 等)。

本清单是 2026-06-19 一次从「主播应付 ¥0」出发的端到端排查中,在**部署分支上逐条复核**的真实问题。其中两条已修复并合并部署。

> 重要校准:原审计的 **C4(AI 全是桩)/C5(OCR 无 worker)在部署分支不成立**——`codex/full-project-ui` 有真实可用的 Tencent OCR 管道(`background_jobs`/`ocr_results` 实跑成功,`extracted_duration` 正确识别)和计费门控接入。这两项是被审计的旧分支特有,部署分支已超越。

---

## 已修复并部署

### D1. OCR 人工确认提交 0 覆盖了识别时长 → 全部报数 yellow、CPT 永不自动付 ✅ 已修复
- 严重度:High ｜ 类别:Bug(资金/证据)｜ 状态:**PR #40 已合并入 `codex/full-project-ui` 并部署**
- 位置:`features/ai/ocr-jobs.ts` `confirmOcrJob` → `pickNumericField`
- 根因:`pickNumericField` 把 `0` 当成有效值;确认弹窗空字段默认 0,于是「确认但没填」用 `manual_result.duration=0` 覆盖了 OCR 已正确识别的时长(如 180)。`screenshot_duration` 被写 0 → 与系统时长 100% 偏差 → 判 yellow → CPT 仅在 green+system 才计 → 小计 ¥0。
- 修复:新增 `pickPositiveNumericField`(`<=0`/UUID 视为未填则回退 OCR 提取值)+ 回归测试。
- 实测复现:同一项目 3 条报数 `extracted_duration=180/180/120` 全部正确,但 `manual_result={"duration":0}` 把它们盖成 0 → 全 yellow。

### D2. 结算页项目下拉显示原始 UUID 而非项目名 ✅ 已修复
- 严重度:Low ｜ 类别:Bug(前端显示)｜ 状态:**PR #41 已合并入 `codex/full-project-ui` 并部署**
- 位置:`components/reference-ui/ops-reference.jsx` `settlementProjectOptions`
- 根因:`settlementScope` 分支拿不到项目名时 `scopeName` 兜底成 `settlementScope.projectId`(原始 UUID);`upsert` 中传入的 `projectName`(=UUID)优先级高于已解析的 `existing.name`,覆盖了真名。手动把 UUID 敲进「结算项目 ID」即触发。
- 修复:`upsert` 忽略「空 / UUID 形态 / 等于 id」的伪名字;scope 不再用原始 UUID 兜底。数据无损(项目 `name` 本就正常)。

---

## 待修复(部署分支特有,尚未处理)

### D3. 计费门控把「保存结算规则」也拦下,且无默认订阅导致每个组织默认 free
- 严重度:Medium ｜ 类别:Bug / 产品
- 位置:`features/billing/billing-gates.ts`(`settlement` 在 `free` 下 `entitled=false`)、`features/billing/billing-status.ts:~132`(无订阅记录时默认回退 `free`);迁移无套餐种子/默认订阅/建组织触发器
- 现象:新建结算规则弹 `Current plan is not entitled to settlement`。
- 根因:① 没有任何套餐种子数据、没有建组织自动开通订阅 → 任何无订阅组织默认 `free` → settlement 权限 false;② 把**配置结算规则**也按 settlement 付费权限拦,可能过激(配置 vs 实际跑结算应区分)。
- 建议:建组织时给默认(试用)订阅;或配置类操作不纳入 settlement 付费门控;区分「配置」与「执行结算」两类权限。
- 临时绕过(已用于解锁测试组织):给组织插一条 `feature_addons(feature_key='settlement', enabled=true)`。

### D4. Supabase `PostgrestError` 被吞成笼统 `Unexpected error` 500;结算入口无 UUID 校验
- 严重度:Medium ｜ 类别:Bug / 可维护性(强化原审计 L1)
- 位置:`features/settlements/settlement-route-utils.ts` `jsonError`;`settlement-repository.ts` `listSettlementPoolReports`(`if (error) throw error`)
- 根因:`jsonError` 只识别 `Error` 实例;Supabase 抛的 `PostgrestError` 是普通对象 → 落到兜底分支返回 `{error:"Unexpected error"}` 500,**错误信息全丢**。叠加「新建批次入口不校验 projectId 是 UUID」,把非 UUID(如「测试」)当 `project_id` 查 uuid 列 → Postgres 报错 → 用户只看到笼统 500,无从排查。
- 建议:`jsonError` 识别 `PostgrestError`(有 `code/message/details`)并映射状态码(如 `22P02`→400);新建批次入口校验 projectId 为 UUID / 项目存在,返回可读 4xx。

### D5. 主播应付规则只在「准入」时拍快照,准入后无 UI 可改
- 严重度:Medium ｜ 类别:产品缺口 / 可维护性
- 位置:`features/applications/application-service.ts` `resolveProjectStreamerSettlementSnapshot`(~631)、`application-repository.ts` upsert `project_streamers`(~405);结算引擎 `settlement-service.ts` 应付走 `ruleByStreamer`(读 `project_streamers`)
- 根因:`project_streamers.settlement_method/hourly_rate` 仅在确认入项时写入一次(取「主播默认(若已配)否则项目默认」),之后结算引擎只读这张表、**不回看项目默认**;全分支再无更新该字段的接口。若准入时项目规则没配好(或主播无默认),应付就落到 `fallbackRule()`=`manual`(人工承载、¥0),且只能改库或重新准入。
- 实测:主播「大帅逼」准入时快照成 `manual` → 即便项目默认已是 CPT/80,应付仍 ¥0;需 DB 补 `project_streamers.settlement_method='cpt', hourly_rate=80`。
- 建议:新增「项目内主播结算规则」编辑入口(改 `project_streamers` 并审计);或结算时对缺失/manual 的 per-streamer 规则回退项目默认。

### D6. 证据分级把 `screenshot_duration = 0` 当成「真实 0 分钟」而非「未提供」
- 严重度:Low ｜ 类别:Bug(领域建模)
- 位置:`features/live-operations/live-report-evidence.ts`(`resolveReportEvidence` 对 `0` 计 100% 偏差)
- 根因:`0` 与 `NULL` 语义混用——「没有截图时长」和「截图显示 0 分钟」被同等处理,前者本应判定为缺证据而非「严重偏差」。这是 D1 的同源问题(D1 修了确认侧回写,这里是分级侧的根)。
- 建议:分级时区分 `0`(未提供)与真实测量值;`<=0` 的截图/认领时长按「缺该轨证据」处理。

---

## 备注

- D3/D5 的临时解锁与数据修正(授予 settlement 加购、改库把存量 yellow 报数转 green、补 per-streamer CPT 规则)均已在测试组织上完成,用于验证 D1 修复链路;生产化前应按上面的建议做产品/代码层修复,而非长期依赖改库。
- 部署方式:pm2 进程 `jingying-cabin` 跑 `next start`(预编译 `.next`),更新需 `git pull → pnpm build → pm2 restart`。
- DB 超级用户/属主为 `supabase_admin`(`postgres` 角色受限,非超级用户、非业务表属主)。
