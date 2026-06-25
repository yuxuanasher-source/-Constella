import type {
  SettlementHourlyTier,
  SettlementPenalty,
  SettlementPenaltyTrigger,
} from "./settlement-engine";

export const SETTLEMENT_RULE_SCHEMA_VERSION = 1;

export const SETTLEMENT_PENALTY_TRIGGERS: SettlementPenaltyTrigger[] = [
  "red_evidence",
  "yellow_evidence",
  "non_system_time",
];

export type StructuredSettlementRule = {
  schemaVersion: number;
  hourlyTiers: SettlementHourlyTier[];
  penalties: SettlementPenalty[];
  floorAmount: number | null;
  capAmount: number | null;
};

export type StructuredSettlementRuleParts = {
  hourlyTiers?: SettlementHourlyTier[];
  penalties?: SettlementPenalty[];
  floorAmount?: number | null;
  capAmount?: number | null;
};

/**
 * Strictly validate a structured settlement rule payload (used on write paths).
 * Throws on any malformed field so the operator gets actionable feedback.
 */
export function validateStructuredSettlementRule(
  value: unknown,
): StructuredSettlementRule {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("结算规则必须是一个对象");
  }
  const record = value as Record<string, unknown>;

  const hourlyTiers = parseHourlyTiers(record.hourlyTiers, { strict: true });
  const penalties = parsePenalties(record.penalties, { strict: true });
  const floorAmount = parseBound(record.floorAmount, "保底金额");
  const capAmount = parseBound(record.capAmount, "封顶金额");

  if (floorAmount != null && capAmount != null && floorAmount > capAmount) {
    throw new Error("保底金额不能高于封顶金额");
  }

  return {
    schemaVersion: SETTLEMENT_RULE_SCHEMA_VERSION,
    hourlyTiers,
    penalties,
    floorAmount,
    capAmount,
  };
}

/**
 * Leniently extract the engine-honored parts from a stored rule payload.
 * Never throws — invalid fields are dropped so settlement never breaks on bad data.
 */
export function extractStructuredSettlementRule(
  value: unknown,
): StructuredSettlementRuleParts {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const parts: StructuredSettlementRuleParts = {};

  const hourlyTiers = parseHourlyTiers(record.hourlyTiers, { strict: false });
  if (hourlyTiers.length > 0) {
    parts.hourlyTiers = hourlyTiers;
  }
  const penalties = parsePenalties(record.penalties, { strict: false });
  if (penalties.length > 0) {
    parts.penalties = penalties;
  }
  const floorAmount = safeBound(record.floorAmount);
  if (floorAmount != null) {
    parts.floorAmount = floorAmount;
  }
  const capAmount = safeBound(record.capAmount);
  if (capAmount != null) {
    parts.capAmount = capAmount;
  }

  return parts;
}

export function isStructuredSettlementRuleEmpty(
  parts: StructuredSettlementRuleParts,
): boolean {
  return (
    (!parts.hourlyTiers || parts.hourlyTiers.length === 0) &&
    (!parts.penalties || parts.penalties.length === 0) &&
    parts.floorAmount == null &&
    parts.capAmount == null
  );
}

function parseHourlyTiers(
  value: unknown,
  { strict }: { strict: boolean },
): SettlementHourlyTier[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    if (strict) throw new Error("阶梯小时单价必须是数组");
    return [];
  }

  const tiers: SettlementHourlyTier[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      if (strict) throw new Error("阶梯档位格式不正确");
      continue;
    }
    const item = raw as Record<string, unknown>;
    const uptoMinutes = parseUptoMinutes(item.uptoMinutes, strict);
    const ratePerHour = toFiniteNumber(item.ratePerHour);
    if (ratePerHour == null || ratePerHour < 0) {
      if (strict) throw new Error("阶梯小时单价必须为非负数");
      continue;
    }
    tiers.push({ uptoMinutes, ratePerHour });
  }

  // Exactly one open-ended (null) top tier is allowed.
  const openTiers = tiers.filter((tier) => tier.uptoMinutes == null);
  if (strict && openTiers.length > 1) {
    throw new Error("只能有一个不封顶的最高档位");
  }

  return tiers;
}

function parseUptoMinutes(value: unknown, strict: boolean): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = toFiniteNumber(value);
  if (parsed == null || parsed <= 0) {
    if (strict) throw new Error("档位时长上限必须为正数分钟");
    return null;
  }
  return Math.trunc(parsed);
}

function parsePenalties(
  value: unknown,
  { strict }: { strict: boolean },
): SettlementPenalty[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    if (strict) throw new Error("扣罚规则必须是数组");
    return [];
  }

  const penalties: SettlementPenalty[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      if (strict) throw new Error("扣罚规则格式不正确");
      continue;
    }
    const item = raw as Record<string, unknown>;
    const trigger = item.trigger;
    if (
      typeof trigger !== "string" ||
      !SETTLEMENT_PENALTY_TRIGGERS.includes(trigger as SettlementPenaltyTrigger)
    ) {
      if (strict) throw new Error("扣罚触发条件无效");
      continue;
    }
    const mode = item.mode === "percent" ? "percent" : "fixed";
    const value_ = toFiniteNumber(item.value);
    if (value_ == null || value_ < 0) {
      if (strict) throw new Error("扣罚金额/比例必须为非负数");
      continue;
    }
    if (mode === "percent" && value_ > 10000) {
      if (strict) throw new Error("扣罚比例不能超过 100%");
      continue;
    }
    penalties.push({
      key:
        typeof item.key === "string" && item.key.trim()
          ? item.key.trim()
          : `${trigger}-${penalties.length}`,
      trigger: trigger as SettlementPenaltyTrigger,
      mode,
      value: value_,
      label:
        typeof item.label === "string" && item.label.trim()
          ? item.label.trim()
          : undefined,
    });
  }

  return penalties;
}

function parseBound(value: unknown, fieldName: string): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = toFiniteNumber(value);
  if (parsed == null || parsed < 0) {
    throw new Error(`${fieldName}必须为非负数`);
  }
  return parsed;
}

function safeBound(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = toFiniteNumber(value);
  if (parsed == null || parsed < 0) {
    return null;
  }
  return parsed;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
