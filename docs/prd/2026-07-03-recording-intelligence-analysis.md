# 录屏智能分析（Recording Intelligence）

日期：2026-07-03
状态：已实现（P1 纵切片）

## 核心定位

把直播录屏从「存储文件」转化为「可量化的数据资产」：在既有 `recording_ai_analyses`
流水线之上，新增四类结构化分析结果与一套组织级自学习校准，替代人工盯播、
人工复盘的低效模式。

## 边界（不可越过）

所有分析结论仅作为审核与运营辅助：**不自动通过、不自动驳回、不自动处罚主播**。
高危告警只发高风险站内通知，处置动作（下播、封禁、驳回）必须由人工执行。
该边界与既有 AI 能力分层（L1 感知 / 人工确认后落库）保持一致。

## 核心能力

### 1. 直播质量结构化分析（`recording-quality-analysis.ts`）

- 输入：帧级信号（游戏画面 / 露脸 / 挂机），来源分 `uploaded`（上游抽帧识别）
  与 `derived`（缺信号时由资产元数据推导的保守兜底，显式标注）。
- 输出：有效开播时长、挂机时长、游戏画面占比、露脸占比（bps 口径），
  有效度判定（`effective` / `below_standard` / `invalid`）与合规判定
  （`pass` / `needs_review` / `violation`）。
- 阈值来自组织校准（`quality_thresholds`），默认：有效占比 ≥70%、挂机 ≤15%、
  游戏画面 ≥60%、露脸 ≥30%、有效时长 ≥20 分钟。
- 落库：`recording_quality_metrics`（追加式，最新一条为当前口径）。

### 2. 话术与转化分析（`recording-script-analysis.ts`）

- 输入：语音转写文本（ASR 逐句 `{atSeconds, text}`）。
- 逐句分类：转化引导 > 游戏讲解 > 互动 > 其他（多命中按优先级归类，口径稳定）。
- 输出：各类频次、占比（bps）、每小时密度；对标高 ROI 话术基线的差距
  （`above` / `on_par` / `below`）与优化建议（全部 `requiresHumanApproval`）。
- 基线：默认 `default_high_roi`；组织内 S/A 级主播样本 ≥3 场后自动切换为
  `org_calibrated`（见自学习）。
- 无转写时显式降级：提示接入 ASR，不产出虚构统计。
- 落库：`recording_script_insights`。

### 3. 违规风险实时检测（`recording-risk-detection.ts`）

- 敏感词词库（赌博 / 外围 / 外挂 / 私下交易…）+ 平台禁播内容规则
  （未成年人充值 / 返现引流 / 虚假抽奖…）+ 违规操作事件
  （站外导流 / 账号共享 / 挂机录播 / 隐私泄露）。
- 告警分 `medium` / `high` 两级；`high` 立即向 `ops_manager` 发送
  `high_risk` 站内通知，按 `source` 去重（同资产同告警只发一次）。
- 存在高危告警时，质量分析的合规判定直接置为 `violation`。
- 落库：`recording_risk_alerts`（`open` / `acknowledged` / `resolved` 状态机，
  仅 MCN 员工可见）。

### 4. 主播能力自动评分（`streamer-capability-scoring.ts`）

- 维度：游戏熟练度、话术流畅度、互动积极性、转化引导能力（0-100 分）。
- 综合分 = 校准权重加权 - 高危告警扣分（每条 10 分，封顶 30 分）；
  等级 S（≥90）/ A（≥80）/ B（≥65）/ C。
- 叠加主播 90 天履约历史（上传次数、上播率、上播测试通过率）生成成长建议。
- 落库：`streamer_capability_reports`（主播端可读自己的报告）。

## 自我学习 / 自我迭代（`recording-intelligence-learning.ts`）

每日定时 runner（`/api/internal/recording-intelligence/learn`，GitHub Actions
`0 2 * * *`）全量读取组织履约数据并产出**递增版本**的校准快照
`recording_intelligence_calibrations`：

- **漏斗指标**：上传率（有上传主播 / 全部主播）、上播测试通过率
  （`recording_submissions` approved 占比）、上播率（`live_tasks` 实际计时
  占比），观察窗口 90 天。
- **卡点定位**：阶段转化率低于目标（上传 80% / 测试 60% / 开播 85%）即产出
  卡点结论（含严重度、证据与运营建议）；样本 <3 时不下结论，避免小样本噪声。
- **权重迭代**：测试通过率卡点 → 评分权重向话术流畅度/游戏熟练度倾斜；
  上播率卡点 → 向互动积极性小幅倾斜；权重恒定归一化为 10000 bps。
- **基线迭代**：S/A 级主播实测话术占比均值（样本 ≥3）替换默认高 ROI 基线。
- 迭代规则全部确定性、可审计（audit log 记录每个版本的输入摘要）。

后续每次录屏分析自动读取最新版本校准，实现「组织数据变化 → 校准版本前进 →
分析口径跟着组织实际表现演进」的闭环。

## API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/recording-assets/[assetId]/intelligence` | MCN staff | 运行全量智能分析（可携带 transcript / operationEvents / signals） |
| GET | `/api/recording-assets/[assetId]/intelligence` | 组织成员（RLS 约束） | 读取最新分析快照 |
| POST | `/api/internal/recording-intelligence/learn` | runner token | 学习并持久化新版本校准 |

## 数据模型

`supabase/migrations/20260703100000_recording_intelligence.sql`：

- `recording_quality_metrics` / `recording_script_insights`：staff 全量 +
  主播读自己资产；
- `recording_risk_alerts`：仅 staff（含敏感词证据）；
- `streamer_capability_reports`：staff 全量 + 主播读自己；
- `recording_intelligence_calibrations`：仅 staff，`(organization_id, version)`
  唯一。

所有比例统一 bps（0-10000）整数口径，与 `scoring_weights` 一致。

## 与既有模块的关系

- 复用 `ai_invocations` 台账（scene `recording.intelligence_report`）与
  `lib/notify` / `lib/audit`。
- 不改动 `recording_ai_analyses` 既有流水线；两者互补：旧流水线产出审核
  辅助草稿，本模块产出量化指标与告警。
- `streamer_profile_insights` 仍然只能由人工确认后写入。
