import type { UsageMetric } from "./usage-metering";
import type { BillingCycle } from "./order-types";

/**
 * 用量加量包单价（分 / 单位）。下单金额 = 单价 × 数量。
 * 与《P6 套餐成本与收入模型测算》保持一致，签约后由「需替换变量」覆盖。
 */
// Partial: 部分指标（如 complex_cost_project）没有加量包单价，不可作为
// usage_addon 下单；computeUsageAddonAmountCents 对未配置的指标会抛错。
export const USAGE_ADDON_UNIT_PRICE_CENTS: Partial<Record<UsageMetric, number>> = {
  ocr: 10,
  ai: 5,
  active_streamer: 5000,
  seat: 3000,
  storage_mb: 1,
  export: 100,
};

/**
 * 功能加购价格（分 / 计费周期）。
 */
export const FEATURE_ADDON_PRICE_CENTS: Record<string, number> = {
  export_center: 30000,
  war_room: 50000,
  vendor_portal: 60000,
  ai_diagnosis: 80000,
  auto_review_active: 100000,
};

export type PlanPriceRow = {
  billingCycle: BillingCycle;
  priceCents: number;
  active: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

/**
 * 取套餐在指定周期下当前 active 的价格（分）。
 * 金额一律服务端计算，前端不可传金额。
 */
export function resolvePlanPriceCents(
  prices: PlanPriceRow[],
  cycle: BillingCycle,
  now = new Date(),
): number {
  const cyclePrices = prices.filter(
    (price) => price.billingCycle === cycle,
  );
  const versioned = cyclePrices.filter(
    (price) => typeof price.effectiveFrom === "string",
  );
  const match =
    versioned.length > 0
      ? versioned
          .filter((price) => isPlanPriceEffective(price, now))
          .sort((left, right) =>
            (right.effectiveFrom ?? "").localeCompare(
              left.effectiveFrom ?? "",
            ),
          )[0]
      : cyclePrices.find((price) => price.active);
  if (!match) {
    throw new Error("Plan price is not configured");
  }
  return nonnegativeCents(match.priceCents);
}

export function isPlanPriceEffective(
  price: PlanPriceRow,
  now = new Date(),
): boolean {
  if (!price.effectiveFrom) {
    return price.active;
  }
  const instant = now.toISOString();
  return (
    price.effectiveFrom <= instant &&
    (price.effectiveTo === null ||
      price.effectiveTo === undefined ||
      price.effectiveTo > instant)
  );
}

export function computeUsageAddonAmountCents(
  metric: UsageMetric,
  quantity: number,
): number {
  const unit = USAGE_ADDON_UNIT_PRICE_CENTS[metric];
  if (unit === undefined) {
    throw new Error(`No add-on price configured for metric ${metric}`);
  }
  const qty = positiveQuantity(quantity);
  return unit * qty;
}

export function computeFeatureAddonAmountCents(featureKey: string): number {
  const price = FEATURE_ADDON_PRICE_CENTS[featureKey];
  if (price === undefined) {
    throw new Error(`No add-on price configured for feature ${featureKey}`);
  }
  return nonnegativeCents(price);
}

function nonnegativeCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Amount must be a non-negative integer of cents");
  }
  return Math.round(value);
}

function positiveQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  return Math.trunc(value);
}
