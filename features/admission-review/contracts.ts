// 上播审核卡点体系：类型与默认卡点字典 v1。
// PRD: docs/prd/2026-07-02-admission-review-checkpoint-learning-prd.md
// 默认字典内置代码（rubric_version = 1），组织自定义时才落
// admission_review_checkpoints 表并 bump 版本；两者结构同形。

export type AdmissionCheckpointSeverity = "hard_block" | "soft" | "bonus";

export type AdmissionCheckpointStage = "mcn_first" | "vendor_second" | "both";

export type AdmissionReviewStage =
  | "ai_pre_review"
  | "mcn_first"
  | "vendor_second";

export type AdmissionCheckpointVerdict = "pass" | "fail" | "not_applicable";

export type AdmissionEvaluationNoteSource =
  | "human"
  | "llm_classified"
  | "needs_classification";

export type AdmissionEvaluationDecision =
  | "approved"
  | "rejected"
  | "needs_changes"
  | "selected"
  | "backup"
  | "pending";

export type AdmissionCheckpoint = {
  key: string;
  label: string;
  description: string;
  severity: AdmissionCheckpointSeverity;
  applicableStage: AdmissionCheckpointStage;
  weight: number;
  active: boolean;
};

export type AdmissionRubric = {
  rubricVersion: number;
  source: "default" | "organization";
  checkpoints: AdmissionCheckpoint[];
};

export type AdmissionCheckpointResultInput = {
  checkpointKey: string;
  verdict: AdmissionCheckpointVerdict;
  confidence?: number;
  note?: string;
  evidence?: Record<string, unknown>;
};

export type AdmissionEvaluationRecord = {
  id: string;
  organizationId: string;
  applicationId: string;
  submissionId: string;
  stage: AdmissionReviewStage;
  rubricVersion: number;
  decision: AdmissionEvaluationDecision;
  decisionConfidence: "high" | "medium" | "low" | null;
  reviewerId: string | null;
  vendorReviewId: string | null;
  aiInvocationId: string | null;
  note: string | null;
  noteSource: AdmissionEvaluationNoteSource;
  createdAt: string;
};

export const ADMISSION_RUBRIC_DEFAULT_VERSION = 1;

// 一审可见项 ≤ 10（防敷衍勾选）；硬卡点排最前。
export const DEFAULT_ADMISSION_CHECKPOINTS: AdmissionCheckpoint[] = [
  {
    key: "compliance_violation",
    label: "违规内容",
    description: "违禁词、夸大承诺、平台红线内容。",
    severity: "hard_block",
    applicableStage: "both",
    weight: 3,
    active: true,
  },
  {
    key: "media_unusable",
    label: "音画不可用",
    description: "无声、花屏、时长严重不足，无法作为审核依据。",
    severity: "hard_block",
    applicableStage: "mcn_first",
    weight: 3,
    active: true,
  },
  {
    key: "identity_mismatch",
    label: "出镜人不符",
    description: "出镜人与报名主播不一致。",
    severity: "hard_block",
    applicableStage: "mcn_first",
    weight: 3,
    active: true,
  },
  {
    key: "script_fit",
    label: "话术贴合项目卖点",
    description: "话术是否覆盖项目核心卖点与目标客群。",
    severity: "soft",
    applicableStage: "both",
    weight: 2,
    active: true,
  },
  {
    key: "rhythm_pacing",
    label: "直播节奏",
    description: "开场、推进、收尾的节奏是否合理。",
    severity: "soft",
    applicableStage: "mcn_first",
    weight: 1,
    active: true,
  },
  {
    key: "interaction_guidance",
    label: "互动引导",
    description: "评论引导、问题抛出与转化动作。",
    severity: "soft",
    applicableStage: "both",
    weight: 1,
    active: true,
  },
  {
    key: "media_quality",
    label: "音画质量",
    description: "画质、收音、灯光达到可上播标准。",
    severity: "soft",
    applicableStage: "both",
    weight: 1,
    active: true,
  },
  {
    key: "persona_fit",
    label: "形象气质匹配",
    description: "形象气质与品类、项目调性匹配。",
    severity: "soft",
    applicableStage: "vendor_second",
    weight: 1,
    active: true,
  },
  {
    key: "equipment_env",
    label: "设备与环境",
    description: "直播设备与环境是否稳定可靠。",
    severity: "soft",
    applicableStage: "mcn_first",
    weight: 1,
    active: true,
  },
  {
    key: "opening_hook",
    label: "开场承接",
    description: "开场 30 秒内有效交代看点与理由。",
    severity: "bonus",
    applicableStage: "mcn_first",
    weight: 1,
    active: true,
  },
  {
    key: "selling_point_coverage",
    label: "卖点覆盖完整",
    description: "核心卖点覆盖完整、表达准确。",
    severity: "bonus",
    applicableStage: "both",
    weight: 1,
    active: true,
  },
];

export function defaultAdmissionRubric(): AdmissionRubric {
  return {
    rubricVersion: ADMISSION_RUBRIC_DEFAULT_VERSION,
    source: "default",
    checkpoints: DEFAULT_ADMISSION_CHECKPOINTS,
  };
}

export function checkpointsForStage(
  rubric: AdmissionRubric,
  stage: Exclude<AdmissionReviewStage, "ai_pre_review">,
): AdmissionCheckpoint[] {
  return rubric.checkpoints.filter(
    (checkpoint) =>
      checkpoint.active &&
      (checkpoint.applicableStage === "both" ||
        checkpoint.applicableStage === stage),
  );
}

export function findCheckpoint(
  rubric: AdmissionRubric,
  key: string,
): AdmissionCheckpoint | null {
  return (
    rubric.checkpoints.find(
      (checkpoint) => checkpoint.key === key && checkpoint.active,
    ) ?? null
  );
}

/**
 * 校验理由码：必须是该阶段可用卡点的 key。返回规范化（去重、去空）的列表。
 */
export function normalizeReasonCodes(
  rubric: AdmissionRubric,
  stage: Exclude<AdmissionReviewStage, "ai_pre_review">,
  reasonCodes: string[],
): string[] {
  const allowed = new Set(
    checkpointsForStage(rubric, stage).map((checkpoint) => checkpoint.key),
  );
  const normalized: string[] = [];
  for (const raw of reasonCodes) {
    const code = raw.trim();
    if (!code || normalized.includes(code)) {
      continue;
    }
    if (!allowed.has(code)) {
      throw new Error(`Unknown admission reason code: ${code}`);
    }
    normalized.push(code);
  }
  return normalized;
}

/**
 * 硬卡点评估：返回 fail 的硬卡点 key 列表。任何一项命中 → 不允许「通过」。
 */
export function failedHardBlocks(
  rubric: AdmissionRubric,
  results: AdmissionCheckpointResultInput[],
): string[] {
  return results
    .filter((result) => result.verdict === "fail")
    .map((result) => findCheckpoint(rubric, result.checkpointKey))
    .filter(
      (checkpoint): checkpoint is AdmissionCheckpoint =>
        checkpoint !== null && checkpoint.severity === "hard_block",
    )
    .map((checkpoint) => checkpoint.key);
}
