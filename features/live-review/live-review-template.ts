// 直播复盘模板：面向游戏直播运营（买量 + 直播双线）的填空式复盘结构。
// 这里既导出原始模板，也提供「按任务上下文预填基础信息」的构造器，
// 保证经营端点开「直播复盘」时拿到的初稿已经带上当前场次信息。

export type LiveReviewTemplateContext = {
  reviewDate?: string;
  sessionLabel?: string;
  product?: string;
  server?: string;
  streamer?: string;
  guild?: string;
  platform?: string;
  liveWindow?: string;
  trafficType?: string;
  goal?: string;
};

const FALLBACK = "";

function cell(value: string | undefined): string {
  const text = (value ?? FALLBACK).trim();
  return text.length > 0 ? ` ${text} ` : " ";
}

// The canonical markdown template. Section headings are stable so the parser
// in live-review-knowledge can locate them reliably.
export function buildLiveReviewTemplate(
  context: LiveReviewTemplateContext = {},
): string {
  const reviewDate =
    [context.reviewDate, context.sessionLabel].filter(Boolean).join(" / ") ||
    FALLBACK;

  return `## 直播复盘模板

### 一、基础信息

| 项目 | 内容 |
|---|---|
| 复盘日期 / 场次 |${cell(reviewDate)}|
| 产品 / 区服 |${cell([context.product, context.server].filter(Boolean).join(" / ") || undefined)}|
| 主播 / 公会 |${cell([context.streamer, context.guild].filter(Boolean).join(" / ") || undefined)}|
| 平台 |${cell(context.platform)}|
| 开播时段 |${cell(context.liveWindow)}|
| 投放/自然量类型 |${cell(context.trafficType)}|
| 本场目标 |${cell(context.goal)}|

### 二、核心数据（目标 vs 实际）

| 指标 | 目标 | 实际 | 达成率 | 备注 |
|---|---|---|---|---|
| 直播时长 | | | | |
| 场观 / UV | | | | |
| 在线峰值 | | | | |
| 平均在线 | | | | |
| 互动率（评论+点赞/场观） | | | | |
| 加粉丝团 / 关注 | | | | |
| 引导下载 / 留资 | | | | |
| 新增注册 | | | | |
| 新增付费人数 | | | | |
| 充值流水（回收） | | | | |
| 投放消耗 | | | | |
| 整体 ROI（回收/消耗） | | | | |
| 单粉/单注册成本 | | | | |
| 千次曝光成本 CPM | | | | |

> 漏斗一行看清：曝光 → 进直播间 → 互动/加团 → 点击下载 → 注册 → 付费，标出**流失最大的那一环**。

### 三、做对了什么（可复制）

- 内容/话术：
- 节奏/憋单/福利节点：
- 投放/选品/时段：
- 主播状态：

### 四、问题与归因（这一段是复盘的核心）

| 问题现象 | 直接原因 | 根本原因 | 是偶发还是结构性 |
|---|---|---|---|
| | | | |

五个维度自检（哪类问题归哪类）：
1. **内容**——开场留人、憋单、信息密度够不够
2. **投放**——计划结构、定向、出价、素材是否拖累 ROI
3. **主播**——状态、控场、转化引导话术
4. **承接**——下载/注册/付费链路有没有断点
5. **运营协同**——开播前预热、福利配置、客服跟单

### 五、行动项（下场必须改的）

| 行动 | 负责人 | 截止时间 | 验证指标 |
|---|---|---|---|
| | | | |
`;
}
