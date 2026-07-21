export type RecordingProductionGuide = {
  gameName: string;
  gameVersion: string;
  serverRegion: string;
  promotionGoal: string;
  targetAudience: string;
  requiredContent: string[];
  requiredTalkingPoints: string[];
  forbiddenContent: string[];
  commercialActions: string[];
  technicalStandard: Record<string, unknown>;
  templateText: string;
  exampleUrl: string | null;
};

export type RecordingGuideRow = {
  game_name?: string | null;
  game_version?: string | null;
  server_region?: string | null;
  promotion_goal?: string | null;
  target_audience?: string | null;
  required_content?: unknown;
  required_talking_points?: unknown;
  forbidden_content?: unknown;
  commercial_actions?: unknown;
  technical_standard?: unknown;
  template_text?: string | null;
  example_url?: string | null;
};

export function normalizeRecordingGuideRow(
  row: RecordingGuideRow | null | undefined,
): RecordingProductionGuide | null {
  if (!row) return null;
  return {
    gameName: clean(row.game_name),
    gameVersion: clean(row.game_version),
    serverRegion: clean(row.server_region),
    promotionGoal: clean(row.promotion_goal),
    targetAudience: clean(row.target_audience),
    requiredContent: stringArray(row.required_content),
    requiredTalkingPoints: stringArray(row.required_talking_points),
    forbiddenContent: stringArray(row.forbidden_content),
    commercialActions: stringArray(row.commercial_actions),
    technicalStandard:
      row.technical_standard && typeof row.technical_standard === "object"
        ? (row.technical_standard as Record<string, unknown>)
        : {},
    templateText: clean(row.template_text),
    exampleUrl: clean(row.example_url) || null,
  };
}

export function defaultRecordingProductionGuide(input: {
  product: string;
  publicSummary: string;
  forceRecording: boolean;
}): RecordingProductionGuide {
  return {
    gameName: input.product.trim(),
    gameVersion: "",
    serverRegion: "",
    promotionGoal: "",
    targetAudience: "",
    requiredContent: input.publicSummary.trim()
      ? [input.publicSummary.trim()]
      : [],
    requiredTalkingPoints: [],
    forbiddenContent: ["虚假宣传", "攻击竞品", "外挂/代充/账号交易", "泄露隐私"],
    commercialActions: [],
    technicalStandard: {
      forceRecording: input.forceRecording,
      minDurationMinutes: input.forceRecording ? 10 : 0,
    },
    templateText:
      "开场说明本场目标；过程围绕目标展示玩法、卖点和互动；结尾总结体验结果和下一步建议。",
    exampleUrl: null,
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}
