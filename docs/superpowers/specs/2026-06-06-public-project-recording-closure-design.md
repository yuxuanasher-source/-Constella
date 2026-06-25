# 组织内公开项目与录播投递闭环设计

## 目标

运营创建或维护项目后，可以把项目设为“当前组织内主播公开可见”。主播端的项目公告入口展示这些公开项目的概括、要求和游戏下载链接；主播可以从公告入口投递录播链接。投递后自动进入现有录屏审核队列，运营审核结果会同步回主播端，形成“公开项目 -> 主播查看 -> 下载游戏 -> 投递录播 -> 运营审核 -> 主播看状态”的闭环。

## 范围

- 项目新增组织内主播公开字段、公告概括和游戏下载链接。
- 运营项目设置支持维护公开状态、公告概括和游戏下载链接。
- 主播端新增或扩展项目公告入口，展示当前组织内公开项目。
- 主播端录播投递绑定项目，并同步到现有 `project_applications` / `recording_submissions` 审核链路。
- 运营端继续使用现有“选播准入 / 录屏审核”队列审核录播。
- 主播端显示自己的项目投递审核状态。

## 非目标

- 不做跨组织、全平台项目广场。
- 不做公开互联网匿名访问。
- 不新建第二套录屏审核状态机。
- 不接真实游戏下载包托管；本轮只保存并展示外部 http(s) 下载链接。
- 不改变结算、排班、直播报数闭环。

## 当前基础

仓库已有这些可复用能力：

- `projects` 已包含项目名称、说明、开放报名、强制录屏等字段。
- `project_applications` 已承载主播报名、邀约、录屏审核、加入确认状态。
- `recording_submissions` 已承载录屏提交版本和审核状态。
- `/api/projects/:projectId/applications` 已支持主播报名。
- `/api/applications/:applicationId/videos` 已支持录屏提交。
- `/api/applications/:applicationId/review` 已支持运营审核录屏。
- `/api/streamer/recordings` 和主播 `/m/recordings` 已有录播链接列表入口，但当前没有项目公告和审核队列同步。

主要缺口是项目没有公开公告字段，主播端没有公开项目读取入口，录播链接投递没有项目绑定，也没有自动进入运营录屏审核队列。

## 数据设计

在 `projects` 增加三个字段：

- `is_public_to_streamers boolean not null default false`
- `public_summary text not null default ''`
- `game_download_url text null`

约束：

- `game_download_url` 为空或匹配 `http://` / `https://`。
- 只有当前组织内主播可以看到 `is_public_to_streamers = true` 且项目状态适合招募或执行的项目。
- 草稿项目可以提前配置公开字段，但主播端不展示 `draft` 项目。

项目列表 DTO 增加：

- `isPublicToStreamers`
- `publicSummary`
- `gameDownloadUrl`

主播公告 DTO 增加：

- 项目基础信息：`id`、`code`、`name`、`product`、`vendor`、`description`
- 公告信息：`publicSummary`、`gameDownloadUrl`
- 投递要求：`openSignup`、`forceRecording`
- 当前主播状态：`applicationId`、`applicationStatus`、`latestRecordingStatus`、`latestRecordingVersion`、`decisionReason`

## 后端设计

### 项目设置

扩展 `updateProjectBasics`：

- 接收 `isPublicToStreamers`、`publicSummary`、`gameDownloadUrl`。
- 对下载链接做 http(s) 校验。
- 继续写普通项目审计，`changedFields` 包含新增字段。

扩展 `listProjects` 和 `SupabaseProjectRepository`：

- 读取新增字段。
- 返回给运营端项目设置和项目列表。

### 主播公开公告

新增主播公告查询能力，例如：

- `GET /api/streamer/project-announcements`

行为：

- 只允许 `streamer` 角色访问。
- 解析当前登录用户绑定的 `streamer_id`。
- 查询当前 `organization_id` 下 `is_public_to_streamers = true` 的项目。
- 排除 `draft`、`ended`、`closed` 项目。
- 合并当前主播对这些项目的 `project_applications` 和最新 `recording_submissions`，返回状态。

### 录播投递

扩展现有主播录播接口，保持旧个人录播链接兼容：

- `POST /api/streamer/recordings`

当请求体包含 `projectId` 时，走项目录播投递闭环：

1. 校验项目属于当前组织、公开可见、未结束，并允许主播报名或投递。
2. 查找当前主播对该项目是否已有 application。
3. 如果没有 application，自动创建 `source = signup` 的报名记录。
4. 如果 application 处于可投递录屏状态，调用现有 `submitRecording` 创建 `recording_submissions` 新版本。
5. application 状态进入 `recording_reviewing`。
6. 现有通知和审计继续生效，运营录屏审核队列自动出现该记录。
7. 返回项目录播 DTO，主播端立即显示“审核中”。

当请求体不包含 `projectId` 时，保留原 `streamer_recording_links` 个人录播库逻辑，避免破坏已有入口。

## 前端设计

### 运营端

在项目设置面板新增：

- “公开给组织内主播”开关。
- “主播公告概括”文本域。
- “游戏下载链接”输入框。

项目详情总览显示：

- 是否公开。
- 下载链接是否已配置。
- 公告概括预览。

### 主播端

在 `/m/recordings` 或现有录屏入口上方增加“项目公告”区：

- 展示公开项目卡片。
- 卡片显示项目名称、产品、公告概括、录屏要求和审核状态。
- 有下载链接时显示“打开游戏下载”。
- 可投递时显示“投递录播”。

录播投递表单增加项目上下文：

- 从公告卡片进入时预填项目。
- 录播链接必填。
- 月份可沿用现有录播库字段，用于主播端展示；同步到审核队列时以 `recording_submissions` 为主。

状态文案：

- 无报名：`待投递`
- `recording_reviewing` 或最新录屏 `submitted/reviewing`：`审核中`
- `recording_required` 或最新录屏 `needs_changes`：`需修改`
- `recording_rejected` 或最新录屏 `rejected`：`未通过`
- `recording_approved` 或最新录屏 `approved`：`已通过，待确认加入`
- `joined`：`已加入项目`

## 权限与隔离

- 主播公告查询严格按 `auth.organizationId` 过滤。
- 主播只能看到当前组织内公开项目。
- 主播只能提交自己的录播，`streamer_id` 来自当前登录用户绑定关系，不信任前端传入。
- 运营审核继续使用现有 MCN staff 权限。
- 不返回厂家单价、主播成本、毛利、结算规则等敏感字段给主播端公告 DTO。

## 测试策略

采用 TDD 实施：

- 先写项目服务测试：新增公开字段更新、下载链接校验、审计字段。
- 先写项目 DTO 测试：运营端 DTO 带公开字段，主播端 DTO 不泄露财务字段。
- 先写主播公告查询测试：只返回当前组织公开且未结束项目，并合并当前主播审核状态。
- 先写录播投递服务/路由测试：带 `projectId` 时自动创建 application、创建 recording submission、状态进入审核。
- 更新主播录播路由测试：无 `projectId` 保持旧逻辑，有 `projectId` 进入项目审核链路。
- 更新 UI smoke 测试：主播能看到公告、下载链接、投递入口和审核状态。

关键命令：

```bash
pnpm test features/projects/project-service.test.ts features/projects/project-ui-dto.test.ts
pnpm test features/recordings app/api/streamer/recordings
pnpm test:ui-smoke
pnpm type-check
```

## 验收标准

- 运营可以把项目设为当前组织内主播公开可见。
- 主播只能看到自己组织内公开项目，不能看到其他组织项目或未公开项目。
- 主播端可以看到项目概括和游戏下载链接。
- 主播从公开项目投递录播后，运营端录屏审核队列出现该记录。
- 运营审核通过、驳回或要求修改后，主播端能看到对应状态。
- 不影响原有个人录播链接提交逻辑。
- 不新增第二套录屏审核状态机。
