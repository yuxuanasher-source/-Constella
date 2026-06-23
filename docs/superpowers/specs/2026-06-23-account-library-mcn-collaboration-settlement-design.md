# 账号库 / MCN 跨组织协作 / 结算增强 设计文档

> 状态：设计稿（待评审）
> 日期：2026-06-23
> 关联分支：`claude/youthful-ride-golnvk`
> 决策前提：账号库做**独立组织资产库**；MCN 协作做**真·跨组织授权**；本轮先交付设计文档，确认后再分期编码。

---

## 0. 背景与现状对齐

系统已是成熟的多租户、RBAC、RLS、证据驱动、审计可追溯的直播经营框架。本需求三块功能，分别对应不同的成熟度：

| 需求 | 现状对象 | 本轮动作 |
|---|---|---|
| 账号库 | `streamer_accounts`（主播子表，仅平台/handle/粉丝数/验证时间） | 新建独立资产表 `platform_accounts`，补齐合规与经营字段 |
| 录屏待审核库 | `recording_submissions`（准入录屏，版本化，单租户） | 新增跨组织上传通道，乙方提交同步进甲方待审核库 |
| 实时审核协同 | `live_reports`（三轨证据/分级/冻结/审核状态机） | 复用现有逻辑，把加入方/厂家接为协同参与方 |
| 结算批次 | `settlement_batches`（项目级）+`settlement_batch_items`（主播/报告级） | 新增自定义收入/成本项模型 + MCN 协同分成 |
| 跨组织协作 | `organization_members` 允许多组织成员，但 RLS 硬隔离单组织 | 新增协作授权表 + 跨组织 RLS 函数，打通租户边界 |

设计的核心原则（沿用现有架构边界，见 `README.md`）：

1. **多租户不破坏**：跨组织放行只能由"显式协作授权"驱动，默认仍单租户隔离。
2. **权限三层**：DB RLS + 服务端 RBAC + 前端门控，三层同时收口。
3. **字段级脱敏**：实名手机号、厂家应收、毛利、成本对无权角色不可见，沿用 `*_safe` 安全视图模式。
4. **审计 + 冻结**：高风险操作（账号实名变更、结算锁定、分成调整）写 `audit_logs`（`is_high_risk=true` 强制 reason），结算金额沿用冻结 trigger 思路。
5. **服务层承载业务规则**：状态机、计算、权限断言放 `features/*`，DB 仅做兜底。

---

## 1. 模块 A：账号库（独立组织资产库）

### 1.1 业务定位

账号是**组织的经营资产**，独立于主播存在：一个自孵化账号可以更换运营主播；合作商账号、主播自带账号也需要统一登记与合规留痕。账号库是后续"配账号给主播上播"的资产来源。

### 1.2 数据模型

新增枚举：

```sql
create type public.platform_account_type as enum (
  'self_incubated',   -- 自孵化
  'partner',          -- 合作商
  'streamer_owned'    -- 主播自带
);

create type public.platform_account_status as enum (
  'active',           -- 在用
  'idle',             -- 闲置
  'frozen',           -- 冻结/封禁
  'retired'           -- 注销
);
```

新增表 `platform_accounts`：

```sql
create table public.platform_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- 平台与标识
  platform text not null,                       -- 抖音/快手/视频号/淘宝直播...
  account_source text,                          -- 账号来源（采买/自注册/合作方提供...）
  account_uid text,                             -- 账号 UID
  xingtu_id text,                               -- 星图 ID
  cooperation_code text,                        -- 合作码

  -- 分类
  account_type public.platform_account_type not null default 'self_incubated',
  status public.platform_account_status not null default 'active',

  -- 实名合规（脱敏字段）
  real_name_holder text,                        -- 实名人
  real_name_phone text,                         -- 实名手机号（脱敏 + 高风险审计）

  -- 运营归属
  operator_id uuid references public.profiles(id),   -- 操作人（运营负责人）
  bound_streamer_id uuid references public.streamers(id) on delete set null, -- 可选绑定主播

  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, platform, account_uid),
  constraint platform_accounts_streamer_owned_requires_bind check (
    account_type <> 'streamer_owned' or bound_streamer_id is not null
  )
);
```

设计要点：
- `unique(organization_id, platform, account_uid)` 防同组织同平台重复登记；`account_uid` 允许为空时用部分唯一索引。
- 账号类型 `streamer_owned`（主播自带）强制绑定主播（CHECK 约束）。
- 与现有 `streamer_accounts` 的关系：保留 `streamer_accounts` 不破坏现有准入/录屏逻辑；在其上加可空列 `platform_account_id uuid references platform_accounts(id)`，作为"主播运营了哪个资产账号"的弱关联，后续可迁移。本轮**不强制迁移**，避免动现有数据。

### 1.3 脱敏视图

`platform_accounts_safe`（security_invoker）对非 owner/ops_manager 角色把 `real_name_phone` 做掩码（如 `138****8888`），`real_name_holder` 仅姓氏。完整明文仅 owner/ops_manager 可读，并在读取明文时不强制审计（读取量大），**变更**实名字段时写高风险审计。

### 1.4 RLS

```
platform_accounts_staff_access:  is_org_member AND is_mcn_staff  (全部增删改查，单租户)
platform_accounts_streamer_read: bound_streamer_id = current_streamer_id  (主播只读自己绑定的账号，且经 *_safe 视图脱敏)
```

### 1.5 服务层 `features/account-library/`

- `account-library-service.ts`：创建/更新/换绑/停用账号；实名字段变更走高风险审计；权限断言 `assertCanManageAccounts`（owner/ops_manager/operator_business）。
- `account-library-queries.ts`：列表、筛选（平台/类型/状态/操作人/是否绑定主播）、按主播聚合。
- `account-library-repository.ts`：Supabase 读写。
- `account-library-ui-adapters.ts`：DTO（camelCase，脱敏后输出）。

### 1.6 API

```
GET  /api/account-library                 列表（支持 platform/type/status/operatorId/boundStreamerId 筛选）
POST /api/account-library                 新增账号
GET  /api/account-library/:accountId       详情
PATCH/api/account-library/:accountId       更新（实名字段变更要求 reason）
POST /api/account-library/:accountId/bind  绑定/换绑主播
```

### 1.7 UI

`app/(ops)/console/account-library/`：账号库列表 + 新增/编辑抽屉；实名手机号默认脱敏，"查看明文"按钮二次确认（owner/ops_manager）。主播档案页增加"绑定账号"区块。

---

## 2. 模块 B：MCN 跨组织协作

### 2.1 业务流（端到端）

```
甲方(被加入方/项目所有者)                    乙方(加入方 MCN)
  │ 项目设置 → 开启协作 → 生成邀请/协作码        │
  │ ───────────────── 邀请/协作码 ───────────────▶│
  │                                              │ 接受邀请 → 加入项目
  │                                              │ 获得「协同面板」
  │                                              │ 上传：主播名称/直播账号/录屏链接
  │ ◀──── 提交同步进甲方「该项目录屏待审核库」 ────│
  │ 一审（复用录屏审核逻辑）                       │
  │   通过 → 建立对厂家「实时审核协同面板」         │
  │   （= 现有 live_reports 履约审核链路）         │
  │ 主播配班上播 → 系统计时 → 报数 → 证据分级       │
  │   → 审核通过 → 进可结算池                      │
  │ 结算：MCN 协同按固定分成结算（见模块 C）        │
```

### 2.2 数据模型

新增枚举：

```sql
create type public.collaboration_status as enum (
  'invited',     -- 已邀请，待乙方接受
  'active',      -- 协作中
  'paused',      -- 暂停
  'ended',       -- 结束
  'revoked'      -- 撤销
);

create type public.collaboration_submission_status as enum (
  'submitted',         -- 乙方已提交，待甲方一审
  'under_review',      -- 甲方一审中
  'approved',          -- 一审通过 → 转入履约链路
  'rejected',          -- 一审驳回
  'needs_changes'      -- 退回补充
);
```

协作授权表 `project_collaborations`：

```sql
create table public.project_collaborations (
  id uuid primary key default extensions.gen_random_uuid(),

  -- 甲方（项目宿主组织）
  host_organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,

  -- 乙方（加入方组织）；邀请阶段可能尚未确定，用 invite_code 承接
  partner_organization_id uuid references public.organizations(id) on delete cascade,
  invite_code text unique,                       -- 协作码（乙方凭此加入）

  status public.collaboration_status not null default 'invited',

  -- 分成结算模式（落到模块 C 使用）
  settlement_mode text not null default 'percentage',  -- 'percentage' | 'hourly_fixed'
  share_percentage numeric(6,4),                 -- 百分比模式：0.0000-1.0000
  hourly_fixed_amount numeric(12,2),             -- 每小时固定抽成

  invited_by uuid references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, partner_organization_id),
  constraint collaboration_share_valid check (
    (settlement_mode = 'percentage' and share_percentage is not null
       and share_percentage >= 0 and share_percentage <= 1)
    or
    (settlement_mode = 'hourly_fixed' and hourly_fixed_amount is not null
       and hourly_fixed_amount >= 0)
  )
);
```

乙方协同提交表 `collaboration_submissions`：

```sql
create table public.collaboration_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  collaboration_id uuid not null references public.project_collaborations(id) on delete cascade,

  -- 冗余双方组织 + 项目，便于双向 RLS
  host_organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,

  -- 乙方上传内容
  streamer_name text not null,                   -- 主播名称（乙方侧文本，未必是甲方主播库实体）
  live_account text,                             -- 直播账号
  recording_url text,                            -- 录屏链接
  note text,

  status public.collaboration_submission_status not null default 'submitted',

  -- 甲方一审
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,

  -- 一审通过后落地的履约对象（关联甲方实体）
  linked_streamer_id uuid references public.streamers(id),
  linked_recording_submission_id uuid references public.recording_submissions(id),

  submitted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

设计要点：
- `collaboration_submissions` 同时冗余 `host_organization_id` 和 `partner_organization_id`，让甲乙双方的 RLS 都能命中。
- 一审通过：在甲方组织内 upsert `streamers`（按 `streamer_name` 或人工匹配）+ 生成 `recording_submissions`，把录屏链接转成现有准入录屏，**复用现有审核与配班链路**——这是"通过后建立对厂家实时审核协同面板（现有逻辑）"的落地点。
- 提交状态机（服务层 `collaboration-submission-state.ts`）：
  ```
  submitted     → [under_review, rejected, needs_changes]
  under_review  → [approved, rejected, needs_changes]
  needs_changes → [submitted, rejected]
  rejected      → []
  approved      → []   (落地到履约链路后不可回退)
  ```

### 2.3 跨组织 RLS（核心难点）

新增 security definer 函数，在不放开默认隔离的前提下，按"协作授权"放行：

```sql
-- 用户是否可经由协作访问该项目（作为甲方成员 或 作为已激活的乙方成员）
create or replace function public.can_access_collaborated_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.can_access_project(target_project_id)  -- 甲方原有逻辑优先
    or exists (
      select 1 from public.project_collaborations pc
      where pc.project_id = target_project_id
        and pc.status = 'active'
        and pc.partner_organization_id is not null
        and public.is_mcn_staff(pc.partner_organization_id)   -- 当前用户是乙方组织 staff
    );
$$;
```

RLS 策略：
- `project_collaborations`：甲方 staff 全权；乙方 staff 对 `partner_organization_id` 命中的行只读 + 接受邀请的受限更新。
- `collaboration_submissions`：
  - 乙方 staff：对自己 `partner_organization_id` 的行可增改（提交/改自己的提交）。
  - 甲方 staff：对自己 `host_organization_id` 的行可读 + 一审更新。
- **被加入方看到全部数据 / 给主播排版**（需求原文）：通过把 `live_tasks`、`live_reports`、`project_streamers` 等关键表的 select 策略，从 `can_access_project` 放宽到 `can_access_collaborated_project`，让乙方 staff 在**该协作项目范围内**读到履约数据。写权限按需细分（排班/排版给乙方开 `live_tasks` 写，结算等敏感写仍限甲方）。

> ⚠️ 风险控制：这是对核心隔离边界的改动。必须新增**跨组织权限回归测试**：未授权乙方读不到、协作 ended/revoked 后立即失效、乙方读不到甲方其他项目、乙方读不到厂家应收/毛利等敏感字段。

### 2.4 服务层 `features/collaborations/`

- `collaboration-service.ts`：开启协作/生成协作码、乙方接受、暂停/结束/撤销；权限断言。
- `collaboration-submission-service.ts`：乙方提交、甲方一审（approve 时落地履约对象）、状态机校验。
- `collaboration-submission-state.ts` + 测试。
- queries / repository / ui-adapters。

### 2.5 API

```
# 甲方
POST  /api/projects/:projectId/collaborations            开启协作/生成协作码
GET   /api/projects/:projectId/collaborations            协作方列表
PATCH /api/collaborations/:id                            暂停/结束/撤销 + 分成配置
GET   /api/projects/:projectId/collaboration-submissions  待审核库（一审队列）
POST  /api/collaboration-submissions/:id/review          一审通过/驳回/退回

# 乙方
POST  /api/collaborations/accept                         凭协作码加入
GET   /api/collaborations/mine                           我加入的协作项目（协同面板入口）
POST  /api/collaborations/:id/submissions                上传主播/账号/录屏链接
GET   /api/collaborations/:id/submissions                我的提交列表
```

### 2.6 UI

- 甲方：项目设置新增「协作」Tab（协作方列表 + 生成协作码 + 分成配置）；项目下新增「录屏待审核（协作）」队列。
- 乙方：`console/collaborations`（我加入的项目）→ 协同面板（上传提交 + 查看一审状态 + 在被授权范围内查看履约数据/排版）。

---

## 3. 模块 C：结算增强（多级 + 自定义项 + MCN 分成）

### 3.1 业务目标

结算批次：**项目（一级）→ 主播（二级）**，收入项与成本项分列，成本项支持自定义；MCN 协同方按固定分成单独计算。最终算出项目/主播毛利，主播端仍只见自己应得。

### 3.2 现状与差距

现有 `settlement_batch_items` 已有 `item_type`（live_report/cpa/cps/gift/manual）与 computed/manual/adjustment 三类金额，但：
- 没有"收入 vs 成本"的方向区分；
- 没有自定义成本类目（推广成本/税费/器材…）；
- 没有 MCN 分成概念。

### 3.3 数据模型

新增枚举：

```sql
create type public.settlement_line_direction as enum ('revenue', 'cost');

create type public.collaboration_settlement_mode as enum (
  'percentage',     -- 按百分比分成
  'hourly_fixed'    -- 每小时固定抽成
);
```

自定义收入/成本项 `settlement_line_items`（挂在批次下，项目+主播维度）：

```sql
create table public.settlement_line_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_batch_id uuid not null references public.settlement_batches(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid references public.streamers(id),     -- null = 项目级整体项

  direction public.settlement_line_direction not null,  -- revenue | cost
  category text not null,                               -- 'manufacturer_unit_price'|'gift'|'hourly_wage'|'promotion'|'tax'|'equipment'|自定义
  label text not null,                                  -- 显示名（支持自定义成本项）
  amount numeric(12,2) not null default 0,

  is_system_generated boolean not null default false,   -- 引擎自动产出 vs 人工录入
  source_snapshot jsonb not null default '{}'::jsonb,   -- 计算溯源（如来自哪些 live_report）
  reason text,                                          -- 人工录入/调整需 reason
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint settlement_line_items_amount_nonnegative check (amount >= 0)
);
```

MCN 协同分成 `collaboration_settlements`（批次 × 协作方）：

```sql
create table public.collaboration_settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,  -- 甲方
  settlement_batch_id uuid not null references public.settlement_batches(id) on delete cascade,
  collaboration_id uuid not null references public.project_collaborations(id),
  project_id uuid not null references public.projects(id) on delete cascade,

  mode public.collaboration_settlement_mode not null,
  share_percentage numeric(6,4),               -- 百分比模式
  hourly_fixed_amount numeric(12,2),           -- 每小时固定
  basis_amount numeric(12,2) not null default 0,   -- 计算基数（百分比模式：项目收入；固定模式：总时长小时数快照）
  total_hours numeric(12,2),                   -- 固定模式用
  computed_amount numeric(12,2) not null default 0,   -- 实际分成额
  manual_amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  constraint collaboration_settlements_amounts_nonnegative check (
    computed_amount >= 0 and manual_amount >= 0
  )
);
```

> 兼容性：保留现有 `settlement_batch_items`（live_report 维度的逐条计算结果）不动；`settlement_line_items` 是更上层的"批次内项目/主播维度的收入成本汇总项"。结算引擎在生成批次时，既写明细 items，也写汇总 line_items（系统项），并允许人工补充自定义 line_items。

### 3.4 计算逻辑（引擎升级）

`settlement-engine.ts` 升级为汇总器：

```
项目收入  = Σ revenue line_items（厂家单价 CPT 应收 + 礼物 + ...）
项目成本  = Σ cost line_items（主播时薪 + 推广 + 税费 + 器材 + ...）
MCN 分成  = collaboration_settlements 求值：
              percentage  → basis_amount(项目收入) × share_percentage
              hourly_fixed → total_hours × hourly_fixed_amount
项目毛利  = 项目收入 − 项目成本 − MCN 分成
主播应得  = 该主播 revenue/cost 中应付主播的部分（沿用 payable 口径，安全视图脱敏）
```

- 厂家单价(CPT应收)、主播时薪仍由现有 CPT/底薪引擎按 `live_reports` 计算后，汇总成对应 line_item。
- 礼物、推广、税费、器材等暂以人工/导入录入为主（与现状一致，礼物本就承载非计算）。

### 3.5 RLS 与脱敏

- `settlement_line_items` / `collaboration_settlements`：甲方 staff 全权；finance 只读；乙方 staff 仅能读到**与自己相关的 MCN 分成行**（`collaboration_settlements` 经 collaboration 关联），读不到甲方成本/毛利/其他主播。
- 主播端：继续只读 `streamer_payable_items_safe`，新增不暴露 `settlement_line_items` 的 revenue/cost 全量；如需让主播看自己时薪明细，提供专门的 payable-only 安全视图。

### 3.6 服务层与 API（扩展 `features/settlements/`）

```
POST  /api/settlement-batches/:batchId/line-items        新增自定义收入/成本项（reason 必填）
PATCH /api/settlement-batches/:batchId/line-items/:id    调整（高风险审计）
DELETE/api/settlement-batches/:batchId/line-items/:id    删除（reason + 审计）
POST  /api/settlement-batches/:batchId/collaboration     生成/更新 MCN 分成
GET   /api/settlement-batches/:batchId/breakdown         项目→主播二级明细 + 毛利
```

锁定/重开沿用现有逻辑：批次 locked 后 line_items / collaboration_settlements 不可改。

### 3.7 UI

结算批次详情页：
- 顶部：项目收入 / 成本 / MCN 分成 / 毛利 概览。
- 收入项、成本项两个可编辑表格（成本项支持「+ 自定义成本项」）。
- MCN 协同分成区块（按协作方展示，模式 + 分成额）。
- 二级展开：按主播看明细。
- 主播移动端：仍只见自己应得。

---

## 4. 横切关注点

- **审计**：账号实名变更、协作开启/撤销、一审决策、line_item 增改删、分成调整、批次锁定/重开，全部走 `lib/audit`，敏感项 `is_high_risk=true` 强制 reason。
- **通知**：乙方提交 → 通知甲方 ops/审核；一审结果 → 通知乙方；分成生成 → 通知 finance。沿用 `lib/notify`。
- **DTO 契约**：camelCase；脱敏字段（实名手机号、厂家应收、成本、毛利）在 DTO 层按角色裁剪；新增 `features/dto-contracts` 测试钉死敏感字段不外泄。
- **迁移**：新增单个迁移文件 `supabase/migrations/<ts>_account_library_collaboration_settlement.sql`，含枚举/表/索引/触发器/RLS；`supabase/seed.sql` 保持空。

---

## 5. 测试计划

| 层 | 覆盖点 |
|---|---|
| 状态机单测 | 协作提交状态机、协作状态机的合法/非法流转 |
| 引擎单测 | 收入/成本汇总、百分比分成、每小时固定分成、毛利计算边界（0 收入、负毛利提示） |
| 服务权限单测 | 账号管理权限、跨组织协作放行/拒绝、一审落地履约对象、line_item reason 强制、锁定后不可改 |
| 跨组织 RLS 回归 | **重点**：未授权乙方读不到；ended/revoked 立即失效；乙方读不到他项目/敏感财务字段；甲方读不到乙方私有数据 |
| DTO 契约 | 实名手机号脱敏；结算敏感字段按角色裁剪 |
| Schema 契约 | 新表索引、CHECK 约束、唯一键、RLS 写边界 |
| 集成/golden | 协作码加入 → 上传 → 一审通过 → 配班上播 → 报数审核 → 进结算池 → 批次（收入/成本/分成/毛利）→ 主播安全账单 |

---

## 6. 分期实施建议

虽然本轮先出文档，编码阶段建议按以下顺序分 PR 落地（每期可单独验收）：

1. **P-A 账号库**：独立资产表 + 服务 + API + UI + 脱敏 + 审计。风险最低，先跑通。
2. **P-B 跨组织协作**：协作授权表 + 跨组织 RLS + 一审落地履约 + 双方面板。风险最高，重点回归测试。
3. **P-C 结算增强**：自定义收入/成本项 + MCN 分成 + 引擎升级 + 二级明细 UI。依赖 P-B 的协作分成配置。

---

## 7. 待确认问题（评审时定）

1. 账号库 `account_uid` 是否允许为空？为空时唯一性如何兜底（可能仅有星图ID/合作码）。
2. 跨组织协作中，乙方对 `live_tasks` 是否需要**写**权限（"给主播排版"）？还是只读、由甲方代排？这影响 RLS 写策略的开放面。
3. 一审通过时，乙方上传的"主播名称"如何与甲方 `streamers` 实体匹配——自动按名建档，还是人工匹配/确认？
4. MCN 分成的计算基数：百分比模式按"项目总收入"还是"项目毛利"？固定模式的"每小时"按系统计时还是结算时长？
5. 礼物/推广/税费/器材等成本项，本轮是纯人工录入，还是需要导入通道？
