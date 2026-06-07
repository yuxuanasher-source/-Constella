# 选播准入项目看板与厂家分享设计

## 目标

把现有“选播准入”从按报名/录屏记录平铺，升级为按项目组织的准入工作台。运营先看到项目，再进入项目下查看录屏明细；每个项目支持一键导出录屏明细；运营可以为单个项目生成厂家分享看板，厂家在外部网页中查看录屏、做选择、填写备注，提交结果后同步回 MCN 端和主端项目明细。

本设计选择“项目聚合 + 分享 token + 厂家决策表”的方案。它复用当前 `project_applications` 和 `recording_submissions` 准入状态机，不新建第二套录屏审核系统；新增的厂家选择结果作为项目录屏的外部决策层，再由服务端按规则同步到现有 application/recording 状态。

## 背景与现状

当前准入主链路已经成立：

- `project_applications` 承载主播报名、邀约、录屏审核和最终加入项目的状态。
- `recording_submissions` 承载同一 application 下的录屏版本、链接、审核状态和审核备注。
- `/api/applications` 返回 MCN 端准入队列。
- `/api/applications/:applicationId/review` 支持运营审核录屏。
- `/api/applications/:applicationId/confirm-join` 支持最终确认主播加入项目。
- 现有经营端“选播准入”页面按 application 扁平展示，项目只是其中一列。
- 现有导出中心有字段白名单、CSV 生成和审计能力，但还没有“项目选播录屏明细”这一导出类型。

主要缺口：

- 运营无法先按项目查看准入进度。
- 项目下录屏明细无法一键导出。
- 厂家无法通过外部网页查看该项目候选录屏并提交选择意见。
- 厂家选择结果没有结构化落表，也没有同步回 MCN 端和主端明细。

## 范围

### 本期包含

- 经营端选播准入改为项目优先的信息架构。
- 项目级录屏明细页。
- 项目级录屏明细导出。
- 项目级厂家分享看板创建、查看、撤销和过期控制。
- 外部厂家看板查看录屏、选择结果、填写备注、提交确认。
- 厂家选择结果同步到 MCN 端选播准入明细和主端项目明细。
- 同步行为写审计，并触发通知或待办。
- 外部分享字段白名单和录屏链接安全处理。

### 本期不包含

- 不给厂家创建组织成员账号。
- 不做完整厂家门户、厂家账号体系或多项目门户首页。
- 不开放厂家查看结算价格、主播成本、供应商成本、MCN 毛利、内部风险备注。
- 不改变主播端提交录屏的主流程。
- 不让厂家选择直接绕过 MCN 最终入项确认。
- 不把分享链接做成公开搜索或跨组织访问。

## 用户角色

### MCN 运营

负责筛选主播录屏、生成分享看板、把链接发给厂家、查看厂家反馈，并做最终业务确认。

可操作：

- 查看项目级准入看板。
- 展开项目录屏明细。
- 审核录屏。
- 导出项目录屏明细。
- 创建、复制、撤销厂家分享链接。
- 查看厂家选择和备注。
- 对厂家“入选”的主播做最终入项确认。

### 项目负责人/主账号

关注项目整体准入结果和厂家确认结果。

可操作：

- 查看项目下所有录屏准入明细。
- 查看厂家选择统计和备注。
- 最终确认主播加入项目。
- 查看分享和厂家提交审计。

### 厂家评审人

不属于 MCN 组织，只通过项目分享链接访问外部看板。

可操作：

- 打开指定项目分享看板。
- 查看项目公开信息和候选录屏明细。
- 打开或播放录屏链接。
- 对每条录屏选择：入选、备选、不通过、需补充。
- 填写每条备注和整项目备注。
- 提交选择结果。

不可操作：

- 查看其他项目。
- 查看内部财务、成本、毛利、供应商和风险字段。
- 直接登录 MCN 控制台。
- 直接把主播加入项目。

## 信息架构

### 经营端选播准入首页

首页从“录屏/报名列表”改为“项目列表”。每个项目作为一组主行或卡片。

项目字段：

- 项目名称
- 项目编号
- 厂商/产品
- 项目状态
- 准入总人数
- 已提交录屏数
- 待 MCN 审核数
- MCN 已通过数
- 厂家待选择数
- 厂家已入选数
- 厂家不通过数
- 需补充数
- 待最终入项确认数
- 分享状态
- 最近录屏提交时间
- 最近厂家提交时间

顶部筛选：

- 项目搜索
- 厂商/产品
- 项目状态
- 分享状态：未分享、已分享、已过期、已撤销
- 厂家选择状态：待选择、已入选、备选、不通过、需补充
- MCN 审核状态：待审核、通过、驳回、需补充、待二次确认

项目行操作：

- 查看录屏明细
- 导出录屏明细
- 创建分享看板
- 管理分享看板
- 复制分享链接

### 项目录屏明细页

进入项目后展示该项目下所有 application 和最新录屏。

明细字段：

- 报名编号
- 主播名称
- 主播平台/账号
- 来源：主播报名、运营邀约
- 录屏版本
- 录屏链接
- 录屏时长
- 提交时间
- MCN 审核状态
- MCN 审核备注
- 厂家选择状态
- 厂家备注
- 厂家提交人
- 厂家提交时间
- 最终入项状态

明细操作：

- 打开录屏
- MCN 审核：通过、驳回、需补充
- 查看历史录屏版本
- 最终确认加入
- 拒绝加入
- 查看审计

### 厂家分享看板

外部分享页不使用经营端导航，不展示内部模块。

页面结构：

- 项目标题区：项目名称、产品、厂商、项目说明、录屏要求、截止时间。
- 统计区：候选数、已选择、入选、备选、不通过、需补充。
- 录屏列表：主播、平台账号、录屏版本、时长、录屏链接、MCN 审核状态、厂家选择控件、备注输入。
- 批量操作区：批量设为备选、清空未提交选择、提交确认。
- 提交确认弹窗：展示本次选择汇总，要求确认后提交。
- 提交成功页：展示提交时间和结果摘要。

厂家可见字段只包含外部评审必要信息。默认不展示主播手机号、身份证、银行卡、结算价、供应商、内部风险备注、MCN 内部审核人。

## 状态设计

### 现有 application 状态继续保留

- `submitted`
- `invited`
- `recording_required`
- `recording_reviewing`
- `recording_approved`
- `recording_rejected`
- `confirmed`
- `joined`
- `declined`
- `withdrawn`

### 现有 recording 状态继续保留

- `submitted`
- `reviewing`
- `approved`
- `rejected`
- `needs_changes`

### 新增厂家选择状态

建议新增独立枚举：

- `pending`：待厂家选择
- `selected`：厂家入选
- `backup`：厂家备选
- `rejected`：厂家不通过
- `needs_changes`：厂家要求补充或重录

### 同步规则

厂家提交后，服务端根据厂家选择更新厂家决策表，并按规则同步现有准入链路。

同步规则：

- `selected`：将最新录屏标记为 `approved`，application 标记为 `recording_approved`。不直接加入项目，仍需 MCN/负责人执行最终确认。
- `rejected`：将最新录屏标记为 `rejected`，application 标记为 `recording_rejected`。
- `needs_changes`：将最新录屏标记为 `needs_changes`，application 回到 `recording_required` 或保持可补充状态，让主播端看到需补充。
- `backup`：只更新厂家决策，不改变 MCN 审核状态。运营可后续手动通过或驳回。
- `pending`：不做业务状态同步。

冲突规则：

- 如果 MCN 已经把 application 置为 `joined`，厂家后续不能再改写业务状态，只记录厂家反馈并提示“该主播已入项，结果仅供备注”。
- 如果厂家提交基于旧录屏版本，而主播已经提交了新版本，服务端拒绝覆盖，提示厂家刷新页面。
- 如果分享看板已过期或撤销，禁止提交。
- 如果同一分享链接重复提交，保留最新一次选择，同时记录历史审计。

## 数据模型

### `project_recording_share_boards`

项目级分享看板。

字段建议：

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `title text not null`
- `token_hash text not null unique`
- `access_code_hash text null`
- `status text not null`：`active`、`expired`、`revoked`
- `expires_at timestamptz not null`
- `allow_vendor_submit boolean not null default true`
- `visible_fields jsonb not null default '{}'`
- `created_by uuid not null`
- `revoked_by uuid null`
- `revoked_at timestamptz null`
- `last_viewed_at timestamptz null`
- `last_submitted_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

索引：

- `(organization_id, project_id, status)`
- `(token_hash)`
- `(expires_at)`

约束：

- `expires_at > created_at`
- `status in ('active', 'expired', 'revoked')`

### `project_recording_share_items`

锁定本次分享包含的录屏范围。

字段建议：

- `id uuid primary key`
- `share_board_id uuid not null`
- `organization_id uuid not null`
- `project_id uuid not null`
- `application_id uuid not null`
- `recording_submission_id uuid not null`
- `recording_version integer not null`
- `sort_order integer not null default 0`
- `created_at timestamptz not null default now()`

用途：

- 避免分享链接创建后新录屏自动暴露给厂家。
- 支持运营重新生成分享版本。
- 厂家提交时校验是否仍基于同一个录屏版本。

### `project_recording_vendor_reviews`

厂家对单条录屏的选择结果。

字段建议：

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `share_board_id uuid not null`
- `application_id uuid not null`
- `recording_submission_id uuid not null`
- `recording_version integer not null`
- `decision text not null`
- `remark text not null default ''`
- `vendor_reviewer_name text not null default ''`
- `vendor_reviewer_contact text not null default ''`
- `submitted_at timestamptz not null`
- `synced_application_status text null`
- `synced_recording_status text null`
- `sync_status text not null default 'synced'`
- `sync_error text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

唯一约束：

- `(share_board_id, recording_submission_id)`

约束：

- `decision in ('pending', 'selected', 'backup', 'rejected', 'needs_changes')`
- `sync_status in ('synced', 'skipped', 'failed')`

## 后端服务设计

### 项目聚合查询

新增服务能力：

- `listAdmissionProjectBoards(client, actor, filters)`
- `listAdmissionProjectRecordings(client, actor, projectId, filters)`

项目聚合返回：

- 项目基础信息
- 录屏准入计数
- MCN 审核计数
- 厂家选择计数
- 分享看板状态
- 最近活动时间

项目明细返回：

- application DTO
- latest recording DTO
- vendor review DTO
- share item DTO

查询要求：

- 必须按 `actor.organizationId` 过滤。
- 必须复用 `can_access_project(project_id)` 或现有项目访问规则。
- 不返回财务敏感字段。
- 最新录屏按 `(application_id, version desc)` 取第一条。

### 导出接口

新增导出类型：

- `admission_recordings`

推荐接口：

- `POST /api/exports/admission-recordings`

请求：

```json
{
  "projectId": "project-id",
  "filters": {
    "vendorDecision": "selected",
    "recordingStatus": "approved"
  }
}
```

响应沿用导出中心：

```json
{
  "export": {
    "kind": "admission_recordings",
    "filename": "admission_recordings-2026-06-07.csv",
    "content": "...",
    "fieldCount": 10,
    "rowCount": 25
  }
}
```

字段白名单：

- 项目编号
- 项目名称
- 厂商/产品
- 主播名称
- 主播平台/账号
- 录屏链接
- 录屏版本
- 录屏提交时间
- MCN 审核状态
- 厂家选择状态
- 厂家备注

导出审计：

- `module = export`
- `action = export`
- `objectType = export_job`
- `after.kind = admission_recordings`
- `after.projectId`
- `after.rowCount`
- `after.fieldCount`

### 分享看板接口

经营端接口：

- `GET /api/projects/:projectId/admission-share-boards`
- `POST /api/projects/:projectId/admission-share-boards`
- `PATCH /api/projects/:projectId/admission-share-boards/:shareBoardId`
- `POST /api/projects/:projectId/admission-share-boards/:shareBoardId/revoke`

创建分享请求：

```json
{
  "title": "某项目选播录屏评审",
  "expiresAt": "2026-06-14T23:59:59.000Z",
  "accessCode": "optional-code",
  "applicationIds": ["application-id-1", "application-id-2"],
  "allowVendorSubmit": true
}
```

创建行为：

1. 校验 MCN staff 权限和项目访问权限。
2. 校验 application 均属于同一项目和组织。
3. 读取每个 application 的最新录屏。
4. 只允许包含已有录屏的 application。
5. 生成随机 token，只保存 token hash。
6. 如果配置访问码，只保存访问码 hash。
7. 写入 share board 和 share items。
8. 写审计。
9. 返回一次性明文分享 URL。

外部厂家接口：

- `GET /api/public/admission-share/:token`
- `POST /api/public/admission-share/:token/verify-access-code`
- `POST /api/public/admission-share/:token/reviews`

厂家提交请求：

```json
{
  "reviewerName": "张三",
  "reviewerContact": "zhangsan@example.com",
  "projectRemark": "整体质量符合预期，优先入选前三位。",
  "items": [
    {
      "recordingSubmissionId": "recording-id-1",
      "recordingVersion": 2,
      "decision": "selected",
      "remark": "表现稳定，可以入选。"
    },
    {
      "recordingSubmissionId": "recording-id-2",
      "recordingVersion": 1,
      "decision": "needs_changes",
      "remark": "需要补一段新手引导阶段录屏。"
    }
  ]
}
```

厂家提交行为：

1. 校验 token hash。
2. 校验分享状态、有效期、访问码验证状态。
3. 校验每条 recording 都属于 share items。
4. 校验 recording version 未过期。
5. upsert 厂家选择结果。
6. 按同步规则更新 recording/application 状态。
7. 写外部提交审计。
8. 给项目负责人和运营发送通知。
9. 返回提交摘要。

## 录屏链接安全

录屏链接分两类：

- 外链 `external_url`：分享页直接显示跳转按钮。
- 私有 `storage_path`：分享页不暴露 path，服务端生成短时 signed URL。

安全要求：

- signed URL 默认 10 分钟有效。
- 分享页每次打开时按 token 权限生成，不把 storage path 返回给前端。
- 外链显示域名，避免厂家误以为是平台托管文件。
- 导出中可以包含外链；私有文件导出时建议导出“临时查看链接”或“需登录查看”的安全链接，不导出 storage path。

## 权限与 RLS

经营端：

- 使用登录用户 Supabase client。
- 仅 MCN staff 可访问。
- 所有查询按 `organization_id` 和项目访问权限过滤。

外部厂家页：

- 不使用组织成员身份。
- 由服务端验证 token 后，用服务端安全查询获取白名单 DTO。
- 外部 token 不直接拥有数据库 RLS 权限。
- 外部提交通过受控服务函数写入厂家决策表和同步业务状态。

数据库策略：

- `project_recording_share_boards`、`project_recording_share_items`、`project_recording_vendor_reviews` 对组织成员按项目权限读写。
- 外部访问不开放直接 RLS policy。
- 如果需要 RPC，同步函数必须校验 share board token 和 project/item 归属。

## 通知与审计

审计事件：

- 创建分享看板：`module = admission`，`action = create_share_board`
- 撤销分享看板：`module = admission`，`action = revoke_share_board`
- 厂家查看分享：可记录轻量访问日志，不建议写主审计表刷屏。
- 厂家提交选择：`module = admission`，`action = vendor_review_submit`
- 厂家选择同步 application：沿用录屏审核审计或新增 `vendor_review_sync`
- 导出项目录屏：`module = export`，`action = export`

通知：

- 厂家提交后通知项目负责人、运营负责人和业务运营。
- `selected` 的主播产生“待最终确认加入”待办。
- `needs_changes` 的主播产生主播端补录提醒。
- 分享即将过期可以产生项目负责人提醒。

## 前端交互细节

### 创建分享看板

入口在项目行和项目明细页顶部。

表单字段：

- 分享标题
- 有效期
- 访问码开关
- 访问码
- 允许厂家提交开关
- 包含录屏范围：全部最新录屏、仅 MCN 已通过、手动勾选

创建成功后：

- 显示分享链接
- 显示复制按钮
- 显示有效期
- 提示“链接只展示当前选中的录屏版本”

### 管理分享看板

展示：

- 当前活跃链接
- 历史链接
- 创建人
- 创建时间
- 过期时间
- 最近访问时间
- 最近提交时间
- 状态

操作：

- 复制链接
- 延长有效期
- 撤销链接
- 重新生成分享

### 厂家选择控件

每条录屏使用单选按钮或分段控件：

- 入选
- 备选
- 不通过
- 需补充

备注输入：

- 单条备注最多 500 字。
- 项目总备注最多 1000 字。
- 不通过和需补充建议要求备注必填。

提交前确认：

- 展示入选、备选、不通过、需补充数量。
- 如果存在未选择项，提示是否按“待选择”保留。
- 提交后按钮禁用，避免重复提交。

## 主端明细同步

主端项目明细应增加“厂家选择”区块或字段：

- 厂家选择状态
- 厂家备注
- 厂家提交人
- 厂家提交时间
- 来源分享看板

项目级统计：

- 厂家入选人数
- 厂家备选人数
- 厂家不通过人数
- 厂家需补充人数
- 待最终确认人数

同步原则：

- MCN 端和主端都读取同一份 `project_recording_vendor_reviews`。
- 不通过前端缓存复制结果。
- 厂家提交后刷新 applications、projects 或项目明细数据。

## 错误处理

经营端：

- 项目没有录屏：创建分享和导出按钮提示“当前项目暂无可分享录屏”。
- 录屏版本变化：提示重新生成分享看板。
- 权限不足：返回 403，并在页面显示不可操作状态。
- 导出无数据：生成只有表头的 CSV 或提示无可导出数据，建议使用提示而不是空文件。

厂家页：

- token 不存在：显示“链接不存在或已被撤销”。
- 链接过期：显示“链接已过期，请联系项目运营”。
- 需要访问码：先进入访问码页。
- 录屏链接失效：该条显示“录屏暂不可访问”，仍允许厂家备注。
- 提交冲突：显示“录屏已有新版本，请联系运营刷新分享链接”。

## 测试策略

### 单元测试

- 项目聚合 DTO 能按项目统计 application 和 recording。
- 最新录屏取最高 version。
- 厂家选择同步规则正确映射 application 和 recording 状态。
- `backup` 不改变业务审核状态。
- `joined` 状态不被厂家提交覆盖。
- 导出字段白名单不包含价格、成本、毛利、内部风险备注。
- token 只保存 hash，不保存明文。

### API 测试

- MCN staff 可创建分享看板。
- streamer 和非项目可访问运营不可创建分享看板。
- 创建分享时只允许同项目 application。
- 外部 token 可读取白名单 DTO。
- 过期或撤销 token 不可读取和提交。
- 厂家提交后写入 vendor reviews。
- 厂家提交后同步现有 application/recording 状态。
- 导出接口只导出指定 projectId 的录屏。

### UI 测试

- 选播准入首页先展示项目。
- 项目可展开录屏明细。
- 项目导出按钮调用项目级导出接口。
- 创建分享成功后出现可复制链接。
- 厂家页可选择录屏并填写备注。
- 厂家提交后 MCN 端显示选择结果。

### 回归测试

- 原有主播录屏提交不带 projectId 时仍走个人录屏库逻辑。
- 原有运营审核录屏接口仍可用。
- 原有最终确认加入项目流程仍可用。
- 导出中心原有导出类型不受影响。

## 分期实施

### 第一阶段：项目优先看板

交付：

- 新增项目聚合查询和 DTO。
- 经营端选播准入首页改为项目列表。
- 项目明细展示录屏列表。
- 保留现有审核和二次确认操作。

验收：

- 打开选播准入时先看到项目。
- 每个项目能看到录屏统计。
- 点击项目能看到录屏明细。

### 第二阶段：项目录屏导出

交付：

- 新增 `admission_recordings` 导出类型。
- 新增服务端项目录屏导出接口。
- 项目行和项目明细增加导出按钮。

验收：

- 一键导出只包含该项目录屏。
- CSV 包含项目、主播、录屏链接、审核状态、厂家选择状态和备注。
- 导出有审计记录。
- 不包含敏感财务和内部风险字段。

### 第三阶段：分享看板只读

交付：

- 新增分享表和分享项表。
- 经营端可创建、复制、撤销分享链接。
- 外部厂家页可只读查看项目录屏。

验收：

- 厂家无需登录即可通过 token 查看指定项目。
- 过期或撤销链接不可访问。
- 厂家页只显示白名单字段。

### 第四阶段：厂家选择与同步

交付：

- 新增厂家决策表。
- 厂家页支持选择和备注。
- 提交结果同步到 recording/application。
- MCN 端和主端显示厂家结果。
- 触发通知和审计。

验收：

- 厂家提交后 MCN 端立刻能看到结果。
- `selected` 进入待最终确认加入。
- `rejected` 和 `needs_changes` 同步到录屏审核状态。
- `backup` 只记录厂家选择，不改变审核终态。

### 第五阶段：增强能力

交付：

- 分享访问日志。
- 重新生成分享版本。
- 批量选择。
- 水印或防复制提示。
- 分享即将过期提醒。

验收：

- 运营能追踪厂家是否访问。
- 分享历史可追溯。
- 多轮分享不会覆盖旧版本审计。

## 验收标准

- 选播准入页面以项目为第一优先级展示。
- 项目之后才展示录屏明细。
- 每个项目能独立查看、筛选和操作录屏。
- 每个项目支持一键导出该项目对应的录屏明细。
- 导出包含项目、主播、录屏链接、审核状态、厂家选择状态和厂家备注。
- MCN 可为单个项目创建分享看板。
- 厂家可通过分享网页查看该项目下的录屏列表。
- 厂家可对录屏进行选择、确认并添加备注。
- 厂家提交结果同步回 MCN 端选播准入明细。
- 厂家提交结果同步回主端项目明细。
- 分享链接支持过期和撤销。
- 外部页面不泄露价格、成本、毛利、供应商内部信息和内部风险备注。
- 所有分享、导出、厂家提交和状态同步都有审计。

## 默认业务决策

- 厂家选择“入选”默认自动同步为录屏通过和 application `recording_approved`，但不自动加入项目。
- 厂家访问默认只需要 token；访问码作为项目分享配置项，由运营按项目开启。
- 厂家默认可见主播展示名、平台和平台账号 handle；不可见手机号、身份证、银行卡、内部真实姓名、结算价、供应商和风险备注。
- 分享链接默认有效期为 7 天，创建时可在 1 到 30 天内调整。
- 第一版每个项目只允许 1 个 active 分享看板；创建新分享时需要先撤销旧分享，历史分享和厂家提交结果保留可追溯。
