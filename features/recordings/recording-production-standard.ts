export type RecordingProductionDimensionKey =
  | "product_understanding"
  | "expression_control"
  | "content_structure"
  | "interaction_design"
  | "commercial_task"
  | "technical_compliance";

export type RecordingSelfAssessmentLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type RerecordSuggestion = "none" | "clip" | "full";

export type RecordingKeyMomentKey =
  | "best_performance"
  | "selling_point"
  | "commercial_task";

export type RecordingProductionDimension = {
  key: RecordingProductionDimensionKey;
  label: string;
  weight: number;
  checkItems: string[];
};

export type RecordingKeyMomentInput = {
  key: RecordingKeyMomentKey;
  startSeconds: number;
  endSeconds: number;
  note?: string;
};

export type RecordingSelfCheckInput = {
  readConfirmed: boolean;
  dimensionScores: Partial<Record<RecordingProductionDimensionKey, number>>;
  keyMoments: RecordingKeyMomentInput[];
  note?: string;
};

export type NormalizedRecordingSelfCheck = {
  readConfirmed: true;
  dimensionScores: Record<RecordingProductionDimensionKey, number>;
  totalScore: number;
  selfLevel: RecordingSelfAssessmentLevel;
  keyMoments: RecordingKeyMomentInput[];
  note: string | null;
};

export const RECORDING_PRODUCTION_DIMENSIONS: RecordingProductionDimension[] = [
  {
    key: "product_understanding",
    label: "产品理解与卖点展示",
    weight: 25,
    checkItems: ["游戏版本正确", "玩法规则准确", "核心卖点出现在画面中"],
  },
  {
    key: "expression_control",
    label: "主播表达与控场能力",
    weight: 20,
    checkItems: ["能边操作边解释", "无长时间无意义沉默", "等待期间能持续输出"],
  },
  {
    key: "content_structure",
    label: "内容结构与吸引力",
    weight: 15,
    checkItems: ["开场有目标", "过程有推进", "结尾有总结"],
  },
  {
    key: "interaction_design",
    label: "互动能力",
    weight: 15,
    checkItems: ["主动抛问题", "围绕玩法设计选择或竞猜", "回应观众可能关心的问题"],
  },
  {
    key: "commercial_task",
    label: "商业任务执行",
    weight: 15,
    checkItems: ["指定入口出现在画面中", "福利和规则准确", "行动引导自然"],
  },
  {
    key: "technical_compliance",
    label: "技术质量与合规",
    weight: 10,
    checkItems: ["画面和人声清晰", "无隐私泄露", "无违规表达"],
  },
];

export const KEY_MOMENT_KEYS: RecordingKeyMomentKey[] = [
  "best_performance",
  "selling_point",
  "commercial_task",
];

export function parseRecordingSelfCheckInput(
  input: unknown,
): RecordingSelfCheckInput {
  if (!isRecord(input)) {
    throw new Error("Recording self-check is required");
  }

  const dimensionScores = parseDimensionScores(input.dimensionScores);
  const keyMoments = parseKeyMoments(input.keyMoments);
  if (
    typeof input.readConfirmed !== "boolean" ||
    !dimensionScores ||
    !keyMoments
  ) {
    throw new Error("Recording self-check is required");
  }

  return {
    readConfirmed: input.readConfirmed,
    dimensionScores,
    keyMoments,
    note: typeof input.note === "string" ? input.note : undefined,
  };
}

export function normalizeRecordingSelfCheck(
  input: RecordingSelfCheckInput,
): NormalizedRecordingSelfCheck {
  if (!input.readConfirmed) {
    throw new Error("Recording task card must be confirmed before submission");
  }

  const dimensionScores = {} as Record<RecordingProductionDimensionKey, number>;
  let totalScore = 0;
  for (const dimension of RECORDING_PRODUCTION_DIMENSIONS) {
    const raw = input.dimensionScores[dimension.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`Missing recording self-check score: ${dimension.key}`);
    }
    const score = Math.max(0, Math.min(dimension.weight, Math.trunc(raw)));
    dimensionScores[dimension.key] = score;
    totalScore += score;
  }

  const keyMoments = normalizeKeyMoments(input.keyMoments);

  return {
    readConfirmed: true,
    dimensionScores,
    totalScore,
    selfLevel: classifySelfAssessmentLevel(totalScore),
    keyMoments,
    note: input.note?.trim() || null,
  };
}

export function classifySelfAssessmentLevel(
  totalScore: number,
): RecordingSelfAssessmentLevel {
  if (totalScore >= 90) return "L4";
  if (totalScore >= 80) return "L3";
  if (totalScore >= 70) return "L2";
  if (totalScore >= 60) return "L1";
  return "L0";
}

export function rerecordSuggestionLabel(value: RerecordSuggestion): string {
  if (value === "clip") return "建议补录指定片段";
  if (value === "full") return "建议整段重录";
  return "暂无重录建议";
}

function normalizeKeyMoments(
  moments: RecordingKeyMomentInput[],
): RecordingKeyMomentInput[] {
  const byKey = new Map<RecordingKeyMomentKey, RecordingKeyMomentInput>();
  for (const moment of moments) {
    if (!KEY_MOMENT_KEYS.includes(moment.key)) continue;
    const startSeconds = Math.max(0, Math.trunc(moment.startSeconds));
    const endSeconds = Math.max(startSeconds + 1, Math.trunc(moment.endSeconds));
    byKey.set(moment.key, {
      key: moment.key,
      startSeconds,
      endSeconds,
      note: moment.note?.trim() || undefined,
    });
  }

  for (const key of KEY_MOMENT_KEYS) {
    if (!byKey.has(key)) {
      throw new Error(`Missing recording key moment: ${key}`);
    }
  }

  return KEY_MOMENT_KEYS.map((key) => byKey.get(key)!);
}

function parseDimensionScores(
  input: unknown,
): RecordingSelfCheckInput["dimensionScores"] | null {
  if (!isRecord(input)) {
    return null;
  }

  const dimensionScores: RecordingSelfCheckInput["dimensionScores"] = {};
  for (const dimension of RECORDING_PRODUCTION_DIMENSIONS) {
    const value = input[dimension.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    dimensionScores[dimension.key] = value;
  }

  return dimensionScores;
}

function parseKeyMoments(input: unknown): RecordingKeyMomentInput[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const keyMoments: RecordingKeyMomentInput[] = [];
  const seenKeys = new Set<RecordingKeyMomentKey>();
  for (const item of input) {
    if (!isRecord(item) || !isRecordingKeyMomentKey(item.key)) {
      return null;
    }
    if (
      typeof item.startSeconds !== "number" ||
      !Number.isFinite(item.startSeconds) ||
      typeof item.endSeconds !== "number" ||
      !Number.isFinite(item.endSeconds)
    ) {
      return null;
    }
    seenKeys.add(item.key);

    keyMoments.push({
      key: item.key,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      note: typeof item.note === "string" ? item.note : undefined,
    });
  }

  for (const key of KEY_MOMENT_KEYS) {
    if (!seenKeys.has(key)) {
      return null;
    }
  }

  return keyMoments;
}

function isRecordingKeyMomentKey(
  value: unknown,
): value is RecordingKeyMomentKey {
  return KEY_MOMENT_KEYS.some((key) => key === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
