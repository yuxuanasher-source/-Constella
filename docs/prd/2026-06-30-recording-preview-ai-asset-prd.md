# 录屏预览与 AI 资产化方案 PRD / 技术设计

| 项 | 内容 |
| --- | --- |
| 文档名称 | 录屏预览与 AI 资产化产品技术方案 |
| 版本 | v1.0 |
| 状态 | 评审稿 |
| 关联模块 | 主播端录屏 / 选播准入 / 主播资源池 / 智能作战台 / AI 调用台账 / 私有存储 / 审计中心 / 套餐用量 |
| 编写日期 | 2026-06-30 |

## 1. 背景与判断

当前录屏在经营舱中主要承担“选播准入证据”的作用：主播提交项目试播录屏，运营审核，必要时分享给厂家复核，最终决定主播是否入项。

用户实际使用中，主播常提交 B 站视频链接作为录屏地址。直接在产品中 iframe 内嵌 B 站主站 URL，例如 `https://www.bilibili.com/video/BV...`，通常会因为站点内嵌策略、登录态、风控或浏览器安全策略导致无法播放。飞书能预览并不代表普通网页也能稳定内嵌主站，因为飞书可能走了自己的链接解析、白名单、客户端能力或平台预览链路。

因此产品需要同时满足三件事：

1. **低摩擦提交**：主播仍可提交 B 站 URL。
2. **产品内预览**：运营尽量在经营舱内直接查看录屏，不频繁跳出。
3. **资产可控与 AI 分析**：正式审核证据和 AI 解析应基于可控文件或可稳定访问的资产，而不是完全依赖外部链接。

核心设计判断：

```text
B 站 URL = 便利预览和外部佐证
原始录屏文件 = 正式证据和长期资产
AI 解析报告 = 资产增值层和辅助决策
人工审核 = 最终准入决策
```

## 2. 产品目标

### 2.1 业务目标

1. 在录屏界面支持 B 站 URL 产品内预览，无法预览时有明确降级路径。
2. 支持主播同时提交外部 URL 与原始视频文件，形成可长期管理的录屏资产。
3. 对录屏进行 AI 解析，输出节奏、话术、互动、音画质量、合规风险、项目匹配度与高光片段。
4. 把录屏从一次性审核材料升级为主播画像、项目匹配、复盘和报价的长期数据资产。
5. 所有 AI 建议只做辅助判断，不直接通过或拒绝主播。

### 2.2 用户目标

| 用户 | 目标 |
| --- | --- |
| 主播 | 低成本提交录屏，能看到审核状态和修改原因 |
| 一线运营 | 不跳出产品即可快速预览，能看到 AI 提醒和证据片段 |
| 运营负责人 | 能比较主播质量、判断项目匹配、复用历史录屏 |
| 老板 / 负责人 | 建立主播内容资产库，降低选人风险，提高项目毛利 |
| 厂家 / 外部审核人 | 通过分享页查看 MCN 已初审通过的候选录屏 |
| 财务 / 风控 | 确认证据链可追溯，不让外部平台链接失效破坏结算或审计 |

## 3. 范围

### 3.1 本期范围

- B 站 URL 解析、标准化与产品内预览。
- URL 预览失败的降级状态与操作。
- 原始视频文件上传、私有存储、播放与证据归档。
- 统一录屏资产层，兼容项目录屏和主播个人录屏库。
- AI 录屏解析流水线设计：转码、抽帧、ASR、OCR、切片、多模态/文本分析、报告生成。
- 录屏审核页 AI 辅助判断 UI。
- 权限、审计、用量计费与失败重试策略。

### 3.2 本期不做

- 绕过 B 站主站播放限制。
- 服务端代理或抓取 B 站真实视频流再转播。
- 自动决定主播入项。
- 用录屏直接训练私有模型并形成不可删除训练集。
- 对外承诺 B 站链接 100% 可内嵌播放。

## 4. 当前系统基础

当前仓库已有以下可复用能力：

| 能力 | 现状 | 本方案复用方式 |
| --- | --- | --- |
| 项目录屏证据 | `recording_submissions` 支持 `storage_path` 或 `external_url` 双轨 | 作为项目准入录屏的兼容层 |
| 主播个人录屏库 | `streamer_recording_links` 支持主播提交录屏 URL | 扩展为资产库入口 |
| 私有上传 | `/api/uploads/signed` 支持 `recordings` 和 `report-screenshots` | 用于原始视频文件上传 |
| 主播 AI 诊断 | `/api/ai/diagnosis` 已有主播安全诊断链路 | 扩展出录屏资产级 AI 分析 |
| AI 调用台账 | `ai_invocations` / `ai_tool_invocations` | 记录录屏解析成本、模型、状态 |
| 审计 | 统一 audit 写入 | 记录录屏提交、替换、AI 报告确认、审核决策 |
| 套餐用量 | P5/P6 有 OCR、AI、存储、导出计量 | 录屏文件、转码、ASR、AI 分析计入用量 |

## 5. 产品形态

### 5.1 录屏提交形态

录屏提交页支持两种材料，并允许并行：

```text
材料 A：外部 URL
  - B 站 URL
  - 其他公开视频 URL
  - 云盘/对象存储分享链接

材料 B：原始视频文件
  - mp4/mov/mkv/webm 等
  - 上传至平台私有存储
  - 作为正式审核证据和 AI 解析源
```

提交策略：

| 项目配置 | 主播可提交 | 审核规则 |
| --- | --- | --- |
| 普通项目 | URL 或文件至少一项 | URL 可作为审核材料，文件推荐 |
| 强制录屏项目 | URL 或文件至少一项 | 入项前可要求文件补充 |
| 高风险 / 高价值项目 | URL + 原始文件 | 原始文件为正式证据 |
| 开启 AI 解析项目 | 原始文件优先 | 无原始文件时只做轻量 URL 元数据分析 |

页面文案原则：

- URL 用于快速预览。
- 原始文件用于稳定播放、AI 分析和长期归档。
- 平台不保证所有第三方 URL 都能产品内播放。

### 5.2 B 站 URL 产品内预览

#### 5.2.1 URL 识别

支持识别：

```text
https://www.bilibili.com/video/BVxxxx
https://b23.tv/xxxx
https://m.bilibili.com/video/BVxxxx
https://www.bilibili.com/video/av123456
```

解析结果：

```json
{
  "provider": "bilibili",
  "providerVideoId": "BVxxxx",
  "providerIdType": "bvid",
  "canonicalUrl": "https://www.bilibili.com/video/BVxxxx",
  "embedUrl": "https://player.bilibili.com/player.html?bvid=BVxxxx&autoplay=0&danmaku=0"
}
```

B 站站外播放器使用 `https://player.bilibili.com/player.html`，优先传 `bvid`，并关闭自动播放与弹幕：

```text
https://player.bilibili.com/player.html?bvid=BVxxxx&autoplay=0&danmaku=0
```

> 注意：即使使用站外播放器，也不能承诺所有 B 站视频均可播放。公开视频、版权限制、登录要求、区域/风控限制、视频删除、UP 主权限设置都可能导致失败。

#### 5.2.2 预览组件状态

| 状态 | 展示 | 用户操作 |
| --- | --- | --- |
| 待解析 | “正在识别链接” | 无 |
| 可内嵌播放 | iframe 播放器 | 播放、全屏、打开原链接 |
| 内嵌失败 | 错误空态 | 在 B 站打开、复制链接、要求补传文件 |
| 非 B 站 URL | 通用外链卡片 | 打开链接、复制链接、补传文件 |
| 文件可播放 | 产品内视频播放器 | 播放、倍速、标记片段 |
| 文件转码中 | 处理中状态 | 稍后刷新、通知完成 |
| 文件异常 | 失败状态 | 重新上传、联系运营 |

iframe 示例：

```tsx
<iframe
  src={embedUrl}
  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
  allowFullScreen
  sandbox="allow-scripts allow-same-origin allow-presentation"
  className="aspect-video w-full rounded-md border"
/>
```

#### 5.2.3 不做服务端代理

明确禁止：

- 抓取 B 站真实视频播放地址。
- 服务端代理 B 站视频流。
- 模拟登录态或绕过风控。
- 将第三方平台视频缓存为平台资产，除非主播上传了原始文件或拥有授权。

原因：

- 技术上不稳定。
- 可能违反第三方平台规则。
- 商业系统的证据链不能依赖脆弱绕过。

### 5.3 原始视频文件资产化

原始文件上传后成为平台正式资产：

```text
主播上传文件
  -> 获取签名上传 URL
  -> 上传至私有存储
  -> 创建 recording_asset
  -> 后台转码/抽帧/提音频
  -> 产品内播放器可播放
  -> AI 解析生成报告
  -> 人工审核引用报告与片段
```

文件资产规则：

| 项 | 规则 |
| --- | --- |
| 文件大小 | MVP 建议单文件上限 2GB，可配置 |
| 时长 | MVP 建议 5 分钟 - 2 小时，可配置 |
| 格式 | mp4/mov/mkv/webm，后台统一转码为 mp4/hls |
| 存储 | 私有 bucket，按组织/主播/资产 ID 分路径 |
| 下载 | 默认不可下载，仅可播放；下载需高权限和审计 |
| 过期 | 默认长期保留，可按套餐设置保留期 |
| 删除 | 删除为软删除，保留审计；已参与审核/结算的证据不可硬删 |

### 5.4 录屏资产库

新增“录屏资产库”概念，挂在主播、项目和应用记录下。

入口：

- 主播移动端：`我的录屏`。
- 经营端 M2 主播池：主播详情 -> 录屏资产。
- 经营端 M3 选播准入：报名/邀约详情 -> 录屏审核。
- 智能作战台：候选主播匹配时引用历史录屏分析。

资产卡片字段：

| 字段 | 示例 |
| --- | --- |
| 标题 | “鸣潮 6 月试播录屏” |
| 来源 | B 站 URL / 原始文件 / URL + 文件 |
| 项目 | 梦幻新游 6 月投放 |
| 审核状态 | 待审 / 通过 / 驳回 / 需修改 |
| AI 状态 | 未解析 / 排队中 / 已完成 / 失败 |
| 录屏标签 | 节奏稳定、高互动、福利转化、音频偏弱 |
| 高光片段 | 00:42-01:20、08:10-09:05 |
| 风险片段 | 03:14-03:55 冷场、12:30 违规承诺疑似 |
| 证据等级 | URL 佐证 / 文件证据 / 已归档 |

## 6. AI 辅助解析设计

### 6.1 AI 能力定位

AI 不做“自动通过/拒绝”。AI 做：

- 信息提取。
- 质量评估。
- 风险提示。
- 时间戳证据定位。
- 匹配建议。
- 运营复核效率提升。

审核决策仍由人完成：

```text
AI 解析报告
  -> 运营查看证据片段
  -> 人工选择通过 / 驳回 / 需修改
  -> 写入审核理由和审计
```

### 6.2 AI 分析维度

| 维度 | 指标 | 输出 |
| --- | --- | --- |
| 开场能力 | 进入主题速度、项目介绍完整度 | 开场评分、建议 |
| 直播节奏 | 冷场比例、节奏波峰、过渡自然度 | 时间轴节奏图 |
| 口播能力 | 表达清晰度、卖点覆盖、重复话术 | 优势/问题话术 |
| 游戏理解 | 玩法讲解、任务目标、福利点表达 | 游戏理解标签 |
| 互动质量 | 弹幕回应、提问处理、情绪调动 | 互动密度与示例 |
| 画面质量 | 清晰度、卡顿、遮挡、横竖屏、UI 完整 | 画面风险 |
| 声音质量 | 音量、噪声、爆音、背景声 | 声音风险 |
| 合规风险 | 敏感词、夸大承诺、低俗、版权风险 | 风险等级与片段 |
| 项目匹配 | 品类、受众、转化目标匹配度 | 建议项目类型 |
| 商业潜力 | 转化话术、福利承接、留存能力 | 辅助匹配分 |

### 6.3 AI 报告结构

```json
{
  "summary": "整体节奏稳定，开场清楚，互动密度中等，适合新游试玩和福利转化项目。",
  "recommendation": "manual_review",
  "confidence": 0.78,
  "scores": {
    "opening": 82,
    "rhythm": 76,
    "interaction": 68,
    "speech": 80,
    "audioVisual": 74,
    "compliance": 90,
    "projectFit": 79
  },
  "tags": ["节奏稳定", "讲解型", "福利转化", "互动中等"],
  "highlights": [
    {
      "startSec": 42,
      "endSec": 80,
      "title": "开场讲清玩法和福利点",
      "evidence": "主播在开场阶段清楚说明活动目标和参与方式。"
    }
  ],
  "risks": [
    {
      "startSec": 194,
      "endSec": 236,
      "level": "medium",
      "type": "rhythm_drop",
      "evidence": "该段互动减少，出现较长停顿。"
    }
  ],
  "suggestions": [
    {
      "target": "主播",
      "proposal": "开播前准备三段固定福利承接话术。",
      "requiresHumanApproval": true
    }
  ]
}
```

推荐枚举：

| 值 | 含义 |
| --- | --- |
| `pass_candidate` | AI 认为可通过，但仍需人工确认 |
| `manual_review` | AI 建议人工重点复核 |
| `needs_changes_candidate` | AI 认为需要补充或修改 |
| `reject_candidate` | AI 认为有明显风险，建议驳回候选 |

### 6.4 AI 流水线

不要把整段长视频直接丢给模型。采用分层流水线：

```text
1. 上传/链接提交
2. 创建 recording_asset
3. 如果有原始文件：
   3.1 转码为标准 mp4/hls
   3.2 提取音频
   3.3 ASR 语音转写
   3.4 按 30-60 秒抽取关键帧
   3.5 OCR 识别画面文字
   3.6 镜头/静音/卡顿/音量基础检测
4. 按时间切片生成 segment facts
5. 多模态/文本模型分析每个片段
6. 聚合成整段报告
7. 写 AI 调用台账和报告版本
8. 通知运营可查看
```

轻量模式：

```text
仅 URL，无原始文件
  -> 只解析 URL 元数据、标题、主播自填说明
  -> 不做完整多模态分析
  -> AI 状态显示“证据不足，建议补传原文件”
```

### 6.5 成本控制

成本控制原则：

- 先用规则和开源/低成本处理提取事实，再让大模型生成判断。
- 默认只分析前 N 分钟 + 高互动/高风险片段，完整分析作为高级套餐能力。
- 长视频按片段计费，支持暂停和重试。
- 相同文件 hash 不重复分析，复用报告。

套餐建议：

| 套餐 | 能力 |
| --- | --- |
| 免费/试用 | URL 提交、外链预览、人工审核 |
| 基础版 | 原文件上传、产品内播放、基础转码 |
| 专业版 | AI 基础解析、标签、高光片段 |
| 旗舰版 | 完整多模态解析、批量解析、历史匹配、供应商质量模型 |

## 7. 审核工作流

### 7.1 主播提交

```text
主播进入项目录屏提交页
  -> 粘贴 B 站 URL
  -> 系统识别并生成预览
  -> 可选/必填上传原文件
  -> 提交
  -> 系统创建资产与审核记录
  -> 如有原文件，进入 AI 解析队列
```

### 7.2 运营审核

```text
运营打开 M3 录屏审核
  -> 左侧候选列表
  -> 中间播放器：优先文件，其次 B 站 embed，其次外链卡片
  -> 右侧 AI 报告：摘要、评分、风险、高光、建议
  -> 查看关键片段
  -> 选择通过 / 驳回 / 需修改
  -> 填写原因
  -> 写入审计与通知主播
```

### 7.3 厂家分享

沿用现有 vendor share 逻辑，但分享对象应只包含 MCN 已通过录屏。

增强：

- 分享页可以展示产品内文件播放器或 B 站 embed。
- 不向厂家暴露内部 AI 原始风险备注，只展示 MCN 可控的候选说明。
- 厂家可见 AI 标签的精简版，例如“讲解型 / 高互动 / 节奏稳定”，不可见内部成本、供应商评分、风险底稿。

### 7.4 复审与再提交

驳回或需修改时：

- 主播看到具体原因。
- 可以重新提交 URL 或新文件。
- 新提交生成新版本。
- 原版本保留为历史，不覆盖。
- AI 报告按版本独立保存。

## 8. 页面设计

### 8.1 主播端录屏提交页

主要区域：

1. 项目信息和录屏要求。
2. URL 输入框。
3. 原文件上传区。
4. 预览卡片。
5. 提交按钮。
6. 历史版本和审核反馈。

交互细节：

- 粘贴 B 站 URL 后立即解析。
- 成功时显示小窗预览。
- 失败时显示“产品内预览失败，不影响提交；建议补传原文件”。
- 如果项目要求正式文件，提交按钮在无文件时禁用或提示。

### 8.2 经营端录屏审核页

建议布局：

```text
┌────────候选列表────────┬────────视频预览────────┬────────AI 报告────────┐
│ 待审核/已通过/需修改    │ 文件播放器 / B站预览     │ 总结 / 分数 / 标签      │
│ 主播、项目、提交时间    │ 高光片段时间轴           │ 风险 / 建议 / 证据      │
└───────────────────────┴───────────────────────┴───────────────────────┘
```

关键操作：

- 播放文件。
- 打开 B 站原链接。
- 复制链接。
- 要求补传原文件。
- 标记高光片段。
- 标记问题片段。
- 通过 / 驳回 / 需修改。
- 重新运行 AI 解析。

### 8.3 主播详情录屏资产库

按主播展示：

- 历史录屏列表。
- AI 标签聚合。
- 适合项目类型。
- 质量趋势。
- 最近风险。
- 最佳片段。

用于 M10 作战台匹配：

```text
项目要求：SLG 新游、福利转化、强讲解
系统推荐：主播 A
推荐理由：
- 历史录屏中福利转化话术完整
- 近三条录屏节奏稳定
- 画面和声音质量达标
```

## 9. 数据模型

### 9.1 推荐新增资产层

保留现有 `recording_submissions` 与 `streamer_recording_links`，新增统一资产层：

```sql
create type public.recording_asset_status as enum (
  'draft',
  'submitted',
  'processing',
  'ready',
  'reviewing',
  'approved',
  'rejected',
  'needs_changes',
  'archived',
  'failed'
);

create type public.recording_source_type as enum (
  'bilibili_url',
  'external_url',
  'uploaded_file'
);

create type public.recording_ai_status as enum (
  'not_requested',
  'queued',
  'processing',
  'succeeded',
  'failed',
  'insufficient_evidence'
);

create table public.recording_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  application_id uuid references public.project_applications(id) on delete set null,
  recording_submission_id uuid references public.recording_submissions(id) on delete set null,
  streamer_recording_link_id uuid references public.streamer_recording_links(id) on delete set null,
  title text not null,
  product text,
  category text,
  status public.recording_asset_status not null default 'submitted',
  ai_status public.recording_ai_status not null default 'not_requested',
  duration_seconds integer,
  evidence_level text not null default 'external_url',
  latest_analysis_id uuid,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_assets_duration_nonnegative check (
    duration_seconds is null or duration_seconds >= 0
  )
);

create table public.recording_asset_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recording_asset_id uuid not null references public.recording_assets(id) on delete cascade,
  source_type public.recording_source_type not null,
  external_url text,
  canonical_url text,
  provider text,
  provider_video_id text,
  provider_id_type text,
  embed_url text,
  storage_bucket text,
  storage_path text,
  transcoded_path text,
  file_hash text,
  file_size_bytes bigint,
  mime_type text,
  preview_status text not null default 'unknown',
  created_at timestamptz not null default now(),
  constraint recording_asset_sources_has_source check (
    external_url is not null or storage_path is not null
  )
);
```

### 9.2 AI 报告表

```sql
create table public.recording_ai_analyses (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recording_asset_id uuid not null references public.recording_assets(id) on delete cascade,
  version integer not null default 1,
  status public.recording_ai_status not null default 'queued',
  model_provider text,
  model_name text,
  input_source_hash text,
  summary text,
  recommendation text,
  confidence numeric,
  scores jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  report jsonb not null default '{}'::jsonb,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recording_asset_id, version)
);

create table public.recording_ai_segments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.recording_ai_analyses(id) on delete cascade,
  recording_asset_id uuid not null references public.recording_assets(id) on delete cascade,
  start_sec integer not null,
  end_sec integer not null,
  segment_type text not null,
  title text,
  evidence text,
  risk_level text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint recording_ai_segments_range_valid check (end_sec > start_sec)
);
```

### 9.3 与现有表的关系

| 现有表 | 关系 |
| --- | --- |
| `recording_submissions` | 项目准入录屏仍使用它管理状态与版本；新增 `recording_asset_id` 或从资产反向引用 |
| `streamer_recording_links` | 个人录屏库 URL 仍保留；新增资产层统一管理 URL、文件和 AI 报告 |
| `ai_invocations` | 每次 AI 调用写台账，记录 provider、tokens、cost、latency |
| `usage_events` | 写入 `storage_mb`、`ai`、`ocr` 或新增 `video_minutes` |
| `audit_logs` | 录屏提交、删除、重跑 AI、审核决策均写审计 |

## 10. API 设计

### 10.1 主播提交录屏

```text
POST /api/recording-assets
```

请求：

```json
{
  "projectId": "project-id",
  "applicationId": "application-id",
  "title": "鸣潮试播录屏",
  "product": "鸣潮",
  "category": "二游",
  "externalUrl": "https://www.bilibili.com/video/BVxxxx",
  "uploadedFile": {
    "bucket": "private",
    "path": "org/recordings/streamer/asset.mp4",
    "fileHash": "sha256...",
    "fileSizeBytes": 123456789,
    "mimeType": "video/mp4"
  }
}
```

响应：

```json
{
  "asset": {
    "id": "asset-id",
    "status": "submitted",
    "aiStatus": "queued"
  },
  "preview": {
    "provider": "bilibili",
    "embedUrl": "https://player.bilibili.com/player.html?bvid=BVxxxx&autoplay=0&danmaku=0",
    "fallbackUrl": "https://www.bilibili.com/video/BVxxxx"
  }
}
```

### 10.2 解析 URL 预览

```text
POST /api/recording-assets/preview
```

用途：不创建资产，仅给前端即时预览。

```json
{
  "url": "https://www.bilibili.com/video/BVxxxx"
}
```

返回：

```json
{
  "provider": "bilibili",
  "canonicalUrl": "https://www.bilibili.com/video/BVxxxx",
  "embedUrl": "https://player.bilibili.com/player.html?bvid=BVxxxx&autoplay=0&danmaku=0",
  "previewMode": "iframe",
  "warnings": []
}
```

### 10.3 获取资产详情

```text
GET /api/recording-assets/:assetId
```

返回：

- 资产基础信息。
- sources。
- 可播放文件签名 URL。
- B 站 embed URL。
- 最新 AI 报告摘要。
- 审核状态与历史版本。

### 10.4 运行 AI 解析

```text
POST /api/recording-assets/:assetId/analyze
```

请求：

```json
{
  "mode": "standard",
  "force": false
}
```

响应：

```json
{
  "analysisId": "analysis-id",
  "status": "queued"
}
```

### 10.5 审核决策

```text
POST /api/recording-assets/:assetId/review
```

请求：

```json
{
  "decision": "approved",
  "reason": "节奏稳定，画面声音达标，适合本项目。",
  "referencedAnalysisId": "analysis-id",
  "referencedSegments": ["segment-id-1", "segment-id-2"]
}
```

必须写审计，并同步到 `recording_submissions` 或 `streamer_recording_links` 的状态。

## 11. 后端服务设计

建议新增模块：

```text
features/recording-assets/
  recording-asset-service.ts
  recording-asset-repository.ts
  recording-url-parser.ts
  recording-preview.ts
  recording-analysis-service.ts
  recording-review-service.ts
  recording-asset-dto.ts
```

### 11.1 URL Parser

职责：

- 标准化 URL。
- 识别 provider。
- 提取 B 站 `bvid` / `aid`。
- 生成 embed URL。
- 生成风险提示。

伪代码：

```ts
export function parseRecordingUrl(url: string): RecordingPreview {
  const parsed = new URL(url);
  if (isBilibiliUrl(parsed)) {
    const bvid = extractBvid(parsed);
    if (bvid) {
      return {
        provider: "bilibili",
        providerVideoId: bvid,
        providerIdType: "bvid",
        canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
        embedUrl:
          `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0&danmaku=0`,
        previewMode: "iframe",
      };
    }
  }

  return {
    provider: "external",
    canonicalUrl: url,
    previewMode: "external_link",
  };
}
```

### 11.2 处理队列

推荐异步任务：

| 队列 | 输入 | 输出 |
| --- | --- | --- |
| `recording_transcode` | uploaded_file source | 标准 mp4/hls、缩略图 |
| `recording_extract_audio` | video file | audio path |
| `recording_asr` | audio path | transcript |
| `recording_frames` | video file | keyframes |
| `recording_ocr` | keyframes | screen text |
| `recording_ai_analysis` | facts + transcript + OCR + frames | report |

MVP 可以先用内部 API route + worker runner，后续升级到队列服务。

### 11.3 文件处理建议

- 转码：FFmpeg。
- 截帧：每 30 秒 + 场景变化 + 静音/高音量片段。
- ASR：优先云厂商语音识别或可替换 provider。
- OCR：复用现有 OCR provider 策略。
- 多模态：对关键帧做小样本输入，不要整段视频暴力传模型。

## 12. 权限与安全

### 12.1 权限矩阵

| 动作 | owner | ops_manager | operator_business | finance | streamer | vendor/share |
| --- | --- | --- | --- | --- | --- | --- |
| 提交本人录屏 | 否 | 否 | 否 | 否 | 是 | 否 |
| 查看项目录屏 | 是 | 是 | 是 | 只读按项目 | 本人 | 分享范围 |
| 查看 AI 内部报告 | 是 | 是 | 是 | 否 | 精简版可选 | 否 |
| 运行/重跑 AI | 是 | 是 | 是 | 否 | 否 | 否 |
| 审核通过/驳回 | 是 | 是 | 是 | 否 | 否 | 否 |
| 下载原文件 | 是 | 是，可配置 | 否 | 否 | 本人可配置 | 否 |
| 删除资产 | 是，需审计 | 是，需审计 | 否 | 否 | 仅未审核草稿 | 否 |

### 12.2 数据安全

- 所有资产带 `organization_id`，开启 RLS。
- 主播只能看自己的资产。
- 外部分享只看 share board 授权的录屏，不看内部 AI 底稿。
- AI 输入要剥离内部财务字段、其他主播数据、供应商成本与内部风险备注。
- 文件播放使用短期签名 URL。
- 下载、删除、重跑 AI、审核决策都写审计。

### 12.3 合规边界

- 第三方 URL 只做内嵌预览和外链跳转。
- 不抓取、缓存、转播第三方视频源。
- 原文件上传时要求主播确认拥有提交和授权审核的权利。
- AI 结果展示“辅助判断”，不作为唯一录用依据。

## 13. 用量与计费

新增计量建议：

| 指标 | 计量单位 | 来源 |
| --- | --- | --- |
| `recording_storage_mb` | MB/月 | 私有文件大小 |
| `recording_transcode_minute` | 分钟 | 转码时长 |
| `recording_asr_minute` | 分钟 | 音频识别时长 |
| `recording_ai_analysis` | 次 | 每次报告 |
| `recording_ai_segment` | 片段 | 长视频分段分析 |

若不新增枚举，MVP 可先映射：

- 文件大小 -> `storage_mb`
- ASR/OCR/模型调用 -> `ai` / `ocr`
- 报告导出 -> `export`

## 14. 失败处理

| 失败点 | 用户提示 | 系统处理 |
| --- | --- | --- |
| B 站预览失败 | “产品内预览失败，可打开原链接或要求补传原文件” | 记录 preview_status，不阻断提交 |
| 文件上传失败 | “上传失败，请重试” | 不创建正式资产或标记 draft |
| 转码失败 | “文件处理失败，请重新上传” | 记录 failed，允许重试 |
| ASR/OCR 失败 | “AI 分析部分缺失” | 降级生成有限报告 |
| 大模型失败 | “AI 报告生成失败，仍可人工审核” | 写台账，允许重跑 |
| URL 失效 | “外部链接不可访问” | 要求主播补传原文件 |

## 15. 测试策略

### 15.1 单元测试

- B 站 URL parser：
  - `BV` 链接。
  - `av` 链接。
  - `b23.tv` 短链（MVP 可只记录为待解析）。
  - 非 B 站 URL。
  - 非 http(s) URL 拒绝。
- 资产创建：
  - URL only。
  - 文件 only。
  - URL + 文件。
  - 无任何 source 拒绝。
- 审核状态同步：
  - asset approved -> recording submission approved。
  - needs changes -> application recording_required。

### 15.2 API 合约测试

- `POST /api/recording-assets/preview` 返回 embed URL。
- `POST /api/recording-assets` 创建资产与 sources。
- `POST /api/recording-assets/:id/analyze` 写 queued。
- `POST /api/recording-assets/:id/review` 写审计并同步状态。
- 主播不能读取其他主播资产。
- 厂家分享不能读取内部 AI report。

### 15.3 UI Smoke

- 主播粘贴 B 站 URL 后出现预览。
- 预览失败时出现 fallback 操作。
- 上传文件后出现转码/处理中状态。
- AI 报告完成后审核页显示评分、标签、片段。
- 运营引用 AI 片段完成通过/驳回。

### 15.4 浏览器验收

最短验收脚本：

```text
1. 主播登录移动端。
2. 进入项目录屏提交页。
3. 粘贴 B 站 BV 链接。
4. 页面生成产品内预览。
5. 上传原始 mp4。
6. 提交录屏。
7. 运营进入 M3 录屏审核。
8. 播放原文件。
9. 查看 AI 报告和高光片段。
10. 点击通过，填写理由。
11. 主播端看到审核通过。
12. 主播详情页出现录屏资产和 AI 标签。
```

## 16. 分期计划

### Phase 0：预览与降级，3-5 天

- 实现 B 站 URL parser。
- 主播端录屏表单粘贴 URL 后即时预览。
- 经营端审核页使用 B 站 embed + fallback。
- 不改数据模型或只加少量 DTO 字段。

交付标准：

```text
B 站 BV 链接可在产品内小窗尝试播放；
播放失败时不阻断审核；
运营能打开原链接和要求补传文件。
```

### Phase 1：原文件上传与资产层，1-2 周

- 新增 `recording_assets` 与 `recording_asset_sources`。
- 接入原文件签名上传。
- 产品内文件播放器。
- 项目录屏和个人录屏库统一展示资产卡片。
- 审计与 RLS 完成。

交付标准：

```text
URL + 原文件可并行提交；
原文件可在产品内播放；
资产可在主播详情和项目准入页复用。
```

### Phase 2：AI 基础解析，2-3 周

- 转码、抽帧、ASR、OCR 基础流水线。
- AI 报告表与报告 UI。
- 标签、高光、风险片段。
- AI 调用台账与用量计量。

交付标准：

```text
上传文件后自动生成 AI 报告；
报告含评分、标签、摘要、高光片段和风险片段；
运营可引用报告做人工审核。
```

### Phase 3：经营飞轮增强，3-6 周

- 主播画像聚合。
- 历史录屏趋势。
- 作战台匹配引用录屏 AI 标签。
- 项目复盘引用录屏片段。
- 供应商质量评分纳入录屏表现。

交付标准：

```text
录屏资产能影响主播匹配、供应商评分和项目复盘；
运营能按 AI 标签筛选主播；
负责人能看到录屏资产带来的选播质量趋势。
```

## 17. 关键产品决策

1. **是否强制原文件**：建议普通项目不强制，高价值/高风险/AI 解析项目强制。
2. **AI 报告是否给主播看**：建议主播只看精简改进建议，不看内部风险评分。
3. **厂家是否看 AI 标签**：建议只看 MCN 审核后的候选说明，不看模型底稿。
4. **录屏保留期**：建议按套餐配置，已参与审核/结算的证据至少保留到项目归档后固定周期。
5. **是否允许下载**：默认不允许，下载必须高权限 + 审计。

## 18. 风险与应对

| 风险 | 应对 |
| --- | --- |
| B 站 embed 不稳定 | 明确只是便利预览，正式证据依赖原文件 |
| AI 误判 | AI 只做辅助，决策必须人工确认 |
| 成本失控 | 分段分析、套餐额度、hash 复用、长视频限制 |
| 存储成本上升 | 保留期、压缩转码、套餐计费 |
| 第三方版权/平台规则 | 不代理、不抓流、不缓存第三方视频 |
| 敏感数据泄漏 | RLS、DTO 脱敏、分享页隔离 |
| 审核链路复杂 | 保留原状态机，资产层只增强，不替代现有准入流程 |

## 19. MVP 推荐

优先顺序：

1. B 站 URL parser + iframe 预览 + fallback。
2. 录屏审核页预览组件。
3. 原文件上传作为正式证据。
4. 资产卡片统一 URL 和文件。
5. AI 基础报告：摘要、标签、分数、高光、风险。
6. 作战台和主播画像再吃录屏资产数据。

MVP 不必一开始做完整多模态大模型。可以先做：

```text
转码 + ASR + 抽帧 + OCR + 规则评分 + 大模型总结
```

这样成本可控，也容易解释。

## 20. 结论

录屏能力应从“审核附件”升级为“主播内容资产”。B 站 URL 解决提交低摩擦和快速预览，原始文件解决证据稳定和产品内播放，AI 解析解决运营效率和长期经营飞轮。

本方案的关键不是追求 100% 内嵌第三方视频，而是建立一条可控链路：

```text
外部 URL 快速预览
  -> 原文件沉淀正式证据
  -> AI 解析生成结构化资产
  -> 人工审核做最终决策
  -> 主播画像 / 项目匹配 / 复盘 / 供应商评分持续复用
```

按这个方向做，录屏不只是“能不能入项”的材料，而会逐步变成经营舱最有壁垒的主播质量数据库。
