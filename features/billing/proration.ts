/**
 * 升降级按比例换算（proration）—— 纯函数，配 golden 测试。
 *
 * 产品规则（《P6 设计文档》5.3）：
 * - 升级立即生效，补差金额 = (新套餐日单价 − 旧套餐日单价) × 本账期剩余天数，floored at 0。
 * - 降级下账期生效，本期金额为 0（不退差）。
 */

export type ProrationInput = {
  oldPriceCents: number;
  newPriceCents: number;
  periodStart: string | Date;
  periodEnd: string | Date;
  now: string | Date;
};

export type ProrationResult = {
  totalDays: number;
  remainingDays: number;
  amountCents: number;
};

export function computeUpgradeProrationCents(
  input: ProrationInput,
): ProrationResult {
  const totalDays = Math.max(1, daysBetween(input.periodStart, input.periodEnd));
  const remainingDays = clamp(
    daysBetween(input.now, input.periodEnd),
    0,
    totalDays,
  );

  const oldDaily = nonnegative(input.oldPriceCents) / totalDays;
  const newDaily = nonnegative(input.newPriceCents) / totalDays;
  const amountCents = Math.max(
    0,
    Math.round((newDaily - oldDaily) * remainingDays),
  );

  return { totalDays, remainingDays, amountCents };
}

/** 降级本期不收费、不退差（下账期切换由账期滚动任务处理）。 */
export function computeDowngradeAmountCents(): number {
  return 0;
}

function daysBetween(from: string | Date, to: string | Date): number {
  const fromMs = utcMidnight(from);
  const toMs = utcMidnight(to);
  return Math.round((toMs - fromMs) / 86_400_000);
}

function utcMidnight(value: string | Date): number {
  const date = new Date(value);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nonnegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
