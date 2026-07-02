# 上播审核卡点体系与自学习闭环 PRD

日期：2026-07-02
状态：设计评审中
范围：主播上播准入（录屏一审/二审）· 不含结算报数审核（已有 auto-review / report-pre-review 覆盖）

---

## 1. 背景与现状评估

### 1.1 现有流程（已落地）

```
主播提交录屏 (recording_submissions, 版本化)
  → MCN 一审  PATCH /api/applications/[id]/review
      决定: approved / rejected / needs_changes
      驳回备注: recording_submissions.review_note（服务端强制必填）
  → 厂家二审  share board 链接 POST /api/public/admission-share/[token]/reviews
      决定: selected / backup / rejected / needs_changes
      备注: project_recording_vendor_reviews.remark
  → confirm-join → 上播 (project_applications.status = joined)
```

全链路已有审计（`audit_logs`），录屏 AI 分析流水线（ASR 转写 + DeepSeek 六维评分）已于 2026-07-02 落地（`features/recordings/recording-ai-pipeline.ts`）。

### 1.2 缺口评估（为什么现在无法「越审越准」）

| # | 缺口 | 后果 |
|---|------|------|
| G1 | 驳回理由是自由文本（`review_note` / `remark` / `decision_reason`），无理由码字典 | 不能聚合统计、不能检索复用、不能变成训练信号 |
| G2 | 审核是「一锤子整体判断」，没有逐项卡点评估；**通过时什么都不记录** | 只知道「过/不过」，不知道「为什么过」——正样本信号全部丢失 |
| G3 | 一审、二审结果从不对齐分析 | 「MCN 通过 → 厂家驳回」是最贵的校准信号（一审漏判），今天无人计算、无处沉淀 |
| G4 | 录屏 AI 分析没有接入准入审核动线 | AI 评分与人工决定互不见面，无法度量 AI 准确率，也无法给审核员省时间 |
| G5 | 没有「预测 vs 决定 vs 结果」的记录与指标 | 谈不上自学习：没有 ground truth 对齐，就没有准确率，更没有阈值校准依据 |
| G6 | 知识沉淀（live_review_documents / knowledge-capture）是被动手工的 | 驳回经验留在审核员脑子里，新审核员/新项目从零开始 |

结论：**数据底座（双审、备注、审计、AI 流水线）已齐，缺的是三样东西——结构化卡点、信号对齐存储、校准回流机制。**

---

## 2. 设计总览

核心思想：把审核从「整体拍板」升级为「结构化卡点评估」，让**每一次人工决定都自动变成一条带标签的训练信号**，用三层由便宜到贵的学习机制回流到下一次判断。

```
                     ┌────────────────────────────────────────────┐
                     │            自学习闭环（第 5 节）              │
                     │  L1 统计校准   L2 知识沉淀   L3 少样本注入    │
                     └──────▲─────────────▲─────────────▲─────────┘
                            │ 指标         │ 复盘知识      │ 相似案例
 主播提交录屏                │             │              │
   │                        │             │              │
   ▼                        │             │              │
 [P0] 硬卡点自动前置检查 ──── 信号: 技术性退回                │
   ▼                        │                            │
 [P1] AI 预审（卡点预测+置信度+证据）◄────────────────────────┘
   ▼                        │
 [P2] MCN 一审: 结构化审核单（AI 预填, 人工定夺）
   │    → 信号: AI预测 vs 人工决定（逐卡点）
   ▼
 [P3] 厂家二审: 决定 + 理由标签/备注（LLM 归一化到理由码）
   │    → 信号: 一审 vs 二审分歧（逐理由码）
   ▼
 confirm-join → 上播
   │
 [P4] 上播后结果回流（30/60 天窗口: 证据等级/异常/复播）
        → 信号: 准入决定的事后正确性
```

治理边界沿用 AI 四层模型（`features/ai/tiers.ts`）：

- L1_PERCEIVE：AI 读转写、历史评估、知识库
- L2_DRAFT：AI 预审结论、每周复盘草稿、阈值调整提案——**全部需人工确认**
- L3_BOUNDED：仅限确定性技术卡点的可逆退回（文件损坏/无音轨/时长不足）
- L4_FORBIDDEN：AI 永不自动通过/驳回上播、永不自动修改卡点权重与阈值

---

## 3. 卡点体系（Checkpoint Rubric）

### 3.1 三类卡点

| 类型 | 语义 | 对决定的影响 |
|------|------|-------------|
| `hard_block` 硬卡点 | 一票否决 | 任一 fail → 只能 rejected / needs_changes，审核单禁用「通过」按钮 |
| `soft` 软卡点 | 扣分项 | fail 累计，影响建议决定与置信度，人工可 override |
| `bonus` 通过点 | 必要/加分项 | 记录「为什么过」，构成正样本信号 |

### 3.2 默认卡点字典 v1（组织级可配置、版本化）

与录屏 AI 六维评分对齐（rhythm / script / interaction / media_quality / compliance / project_match），再补准入特有项：

| key | 名称 | 类型 | 默认适用 |
|-----|------|------|---------|
| `compliance_violation` | 违规内容（违禁词/夸大承诺/平台红线） | hard_block | 一审+二审 |
| `media_unusable` | 音画不可用（无声/花屏/时长严重不足） | hard_block | 一审 |
| `identity_mismatch` | 出镜人与报名主播不符 | hard_block | 一审 |
| `script_fit` | 话术贴合项目卖点 | soft | 一审+二审 |
| `rhythm_pacing` | 直播节奏（开场/推进/收尾） | soft | 一审 |
| `interaction_guidance` | 互动引导与转化动作 | soft | 一审+二审 |
| `media_quality` | 音画质量达标 | soft | 一审 |
| `persona_fit` | 形象气质与品类匹配 | soft | 二审为主 |
| `equipment_env` | 设备与直播环境 | soft | 一审 |
| `opening_hook` | 开场 30 秒有效承接 | bonus | 一审 |
| `selling_point_coverage` | 核心卖点覆盖完整 | bonus | 一审+二审 |

原则：**一审审核单可见项 ≤ 10 个**（防敷衍勾选）；硬卡点排最前；每项三态 `pass / fail / n/a` + 可选单条备注。

### 3.3 理由码（驳回备注结构化）

- 驳回/需修改时：**至少选 1 个理由码**（= fail 的卡点 key）+ 自由文本备注（保留现有习惯）。
- 厂家端**不加填写负担**：保持现状（决定 + remark 自由文本 + 可选标签），提交后由 LLM 异步归一化到同一套理由码（`source = "llm_classified"`，低置信度的进人工确认队列）。
- 主播端回流：驳回理由以「卡点清单 + 改进建议」结构化展示（复用现有公告 DTO 通道），提升返修一次通过率。

---

## 4. 数据模型（新增迁移）

```sql
-- 卡点字典（组织级、版本化；修改 = 新版本行，不原地改）
create table admission_review_checkpoints (
  id uuid primary key,
  organization_id uuid not null,
  rubric_version integer not null,
  key text not null,                -- compliance_violation / script_fit / ...
  label text not null,
  description text,
  severity text not null check (severity in ('hard_block','soft','bonus')),
  applicable_stage text not null check (applicable_stage in ('mcn_first','vendor_second','both')),
  weight numeric not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, rubric_version, key)
);

-- 一次审核事件（一审/二审/AI 预审 各一条）
create table admission_review_evaluations (
  id uuid primary key,
  organization_id uuid not null,
  application_id uuid not null references project_applications(id),
  submission_id uuid not null references recording_submissions(id),
  stage text not null check (stage in ('ai_pre_review','mcn_first','vendor_second')),
  rubric_version integer not null,
  decision text not null,            -- approved/rejected/needs_changes/selected/backup/...
  decision_confidence text,          -- AI 预审: high/medium/low；人工为 null
  reviewer_id uuid,                  -- 人工审核者；AI 为 null
  vendor_review_id uuid,             -- 二审关联 project_recording_vendor_reviews
  ai_invocation_id uuid,             -- AI 预审关联台账
  note text,                         -- 自由文本备注（保留）
  note_source text not null default 'human',  -- human / llm_classified
  created_at timestamptz not null default now()
);

-- 逐卡点结果（人工与 AI 同构，可直接对齐）
create table admission_review_checkpoint_results (
  id uuid primary key,
  organization_id uuid not null,
  evaluation_id uuid not null references admission_review_evaluations(id) on delete cascade,
  checkpoint_key text not null,
  verdict text not null check (verdict in ('pass','fail','not_applicable')),
  confidence numeric,                -- AI 预审 0-1；人工为 null
  note text,
  evidence jsonb not null default '{}'::jsonb,  -- AI: 转写片段+时间戳引用
  unique (evaluation_id, checkpoint_key)
);

-- 对齐信号（由触发器/nightly job 物化，供指标与检索）
create table admission_review_signals (
  id uuid primary key,
  organization_id uuid not null,
  application_id uuid not null,
  submission_id uuid not null,
  signal_kind text not null check (signal_kind in (
    'ai_vs_mcn',          -- AI 预测 vs 一审（逐卡点 delta 在 payload）
    'mcn_vs_vendor',      -- 一审通过 vs 二审驳回/需修改（漏判）
    'resubmission_cycle', -- 驳回→返修→再审 轨迹
    'post_join_outcome'   -- 上播后 30/60 天结果回看
  )),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- 校准配置（阈值只能经 L2 草稿人工确认后变更）
create table admission_review_calibration (
  organization_id uuid not null,
  checkpoint_key text not null,
  score_cutoff integer,              -- AI 分数≥此值预测 pass
  min_confidence numeric,            -- 低于此置信度强制 manual
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, checkpoint_key)
);
```

指标物化：`admission_review_metrics`（周期、卡点、指标名、分子分母），由 nightly runner 写入。

所有表：`organization_id` + RLS（沿用现有 `is_org_member`/`is_mcn_staff` 模式）；写路径全部过 `lib/audit`。

---

## 5. 自学习闭环（三层，由便宜到贵）

### 5.1 L1 统计校准（确定性，零 token 成本）

Nightly runner（沿用 runner token 模式，`POST /api/internal/admission-metrics/run`）计算：

| 指标 | 定义 | 用途 |
|------|------|------|
| AI-人工一致率 | 逐卡点 AI verdict == 一审 verdict 占比 | AI 预审可信度总览 |
| AI 漏放率（false-pass） | AI pass 且人工 fail | **最重要**：决定快速通道是否可开 |
| AI 误拦率（false-block） | AI fail 且人工 pass | 决定是否浪费审核员注意力 |
| 一审漏判率 | MCN 通过 → 厂家 rejected/needs_changes | 一审校准的北极星指标 |
| 理由码分布漂移 | 按项目品类/平台/厂家聚合的驳回理由 Top-N 变化 | 发现新风险模式 |
| 返修一次通过率 | rejected → 下一版本 approved 占比 | 度量驳回备注质量 |

校准动作：当某卡点样本量 ≥ 30 且漏放率超阈，生成 **阈值调整提案（L2 草稿）**：如「compliance 卡点 cutoff 70→80，因厂家近 4 周在该项驳回一审通过件 31%」→ 人工确认后写入 `admission_review_calibration` 并 bump rubric 说明。**样本不足不出提案**（防小样本过拟合）。

### 5.2 L2 知识沉淀（RAG，复用 knowledge-capture）

- **逐案沉淀**：每次带理由码的驳回自动生成知识片段（新增 docType `admission_rubric`），标签带品类/平台/厂家/卡点 key。例：「某 SLG 品类，厂家近期高频以 script_fit 驳回：话术未提『开服冲榜』节点」。
- **每周复盘草稿**：AI 汇总本周分歧信号 → 「审核校准周报」草稿（分歧 Top 案例、理由码漂移、建议动作）→ 人工确认 → 入知识库 + 可选 rubric 版本更新。复用现有 `ai_drafts` confirm/discard 流。
- **检索注入**：AI 预审 prompt 注入 top-k 相关知识（按 project/product/platform/checkpoint 检索，复用 `rankKnowledgePassages`）。

### 5.3 L3 少样本注入（LLM 行为学习，不做微调）

AI 预审时检索 **3-5 条最相似历史案例**（同品类/平台，卡点结果相似度）连同其**最终人工决定与理由**注入 prompt——这是无微调条件下让模型「学习」组织口味的最有效方式，且每一条都是人工确认过的 ground truth。

微调（fine-tune）暂不做：需要数千条标注样本才划算，且当前架构（动态 few-shot + 校准阈值）可持续吸收新信号、无训练运维成本。样本量到位后可评估。

### 5.4 准确率驱动的能力升级（灰度路径）

沿用 auto-review 的 shadow → active 模式：

1. **Shadow（上线即有）**：AI 预审只记录预测，人工照常全审。积累对齐数据。
2. **辅助（默认目标态）**：审核单 AI 预填 + 证据引用，人工改动即信号。预计一审效率显著提升。
3. **快速通道（严格准入）**：某卡点连续 4 周漏放率 < 5% 且样本 ≥ 100 → 该项高置信 pass 件进入「抽检队列」（如 20% 抽检），**仍是人工点通过，只是排序与批量化**。上播决定永不自动化（L4）。

---

## 6. 技术方案与落地计划

### 6.1 复用清单（不重造轮子）

| 能力 | 复用 |
|------|------|
| AI 评分与转写 | `recording-ai-pipeline.ts`（ASR+DeepSeek 六维评分，已落地） |
| 草稿确认流 | `features/ai/drafts.ts` + `/api/ai/drafts/*` |
| 知识沉淀与检索 | `knowledge-capture.ts` / `knowledge-repository.ts` |
| shadow/active 门控模式 | `features/auto-review/auto-review-engine.ts` 的模式照搬 |
| 调用台账/计费 | `invocation-ledger.ts` |
| 定时任务 | runner token 模式（OCR/录屏 AI/异常扫描同款） |
| 审计/RLS | `lib/audit` + 现有迁移里的 policy 模板 |

### 6.2 分期计划

**Phase 0 · 理由码打底（1-2 天）**
- 迁移：4 张表（checkpoints/evaluations/checkpoint_results/signals）+ 默认字典 v1
- 一审 API 驳回时必选理由码（向后兼容：老客户端只传 note 时服务端标 `needs_classification`）
- 厂家 remark 的 LLM 归一化 job（挂现有异常扫描 runner 节奏）
- 验收：新驳回 100% 带理由码；历史 remark 分类回填 ≥ 80%

**Phase 1 · 结构化审核单（3-5 天）**
- 一审 UI：卡点清单三态勾选 + 硬卡点联动禁用「通过」+ 理由码自动汇总进备注
- `admission_review_evaluations` 落库 + 审计；主播端结构化驳回理由展示
- 二审 share board：可选理由标签（不强制）
- 验收：一审事件 100% 产生 evaluation + checkpoint_results

**Phase 2 · AI 预审接入（3-5 天）**
- 录屏提交后自动触发：复用录屏 AI 流水线 → 新增 rubric 映射 prompt（输出逐卡点 verdict + confidence + 转写证据引用），落 `stage='ai_pre_review'` evaluation
- 一审 UI 预填 AI 结果；人工提交时自动写 `ai_vs_mcn` 信号
- 二审决定回写时自动写 `mcn_vs_vendor` 信号
- 验收：预审覆盖率 ≥ 95%（ASR 可用件）；每件一审均产生对齐信号

**Phase 3 · 校准与复盘（2-3 天）**
- nightly metrics runner + `/console` 审核校准看板（一致率/漏放/漏判/理由码漂移）
- 每周复盘 AI 草稿 → 人工确认 → 知识库 + 阈值提案流
- 验收：看板可用；首份周报草稿生成

**Phase 4 · 持续进化（长期）**
- few-shot 相似案例注入；上播后 outcome 回流信号（30/60 天窗口）
- 快速通道灰度（按 5.4 准入标准，先单一低风险品类试点）

### 6.3 风险与对策

| 风险 | 对策 |
|------|------|
| 审核员敷衍勾选，信号变噪声 | 卡点 ≤ 10 项；AI 预填降低成本；周报暴露「与 AI/厂家分歧率异常低」的审核员供抽查 |
| 厂家不配合结构化 | 厂家零新增负担，LLM 事后归一化；低置信度进人工确认队列 |
| 小样本过拟合 | 阈值提案要求 n ≥ 30；快速通道要求 n ≥ 100 + 4 周稳定 |
| 品类漂移（新游戏类型规则不同） | 指标与 few-shot 检索都按品类/平台分桶；新品类自动回到全人工 |
| 敏感数据外泄到厂家端 | share board 沿用现有脱敏（不含成本/毛利/其他主播信息） |
| AI 越权 | 上播通过/驳回、rubric/阈值变更均为 L4/L2，代码层由 bounded-gateway 挡死 |

### 6.4 成功指标（上线 8 周评估）

1. 一审漏判率（MCN 通过→厂家驳回）下降 ≥ 30%
2. 一审单件中位审核时长下降 ≥ 40%（AI 预填生效）
3. AI 预审整体一致率 ≥ 80%，硬卡点漏放率 < 5%
4. 主播返修一次通过率上升 ≥ 20%（结构化驳回理由生效）
