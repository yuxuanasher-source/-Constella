export type PublicPricingPlan = {
  id: string;
  code: string;
  name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  included_active_streamers: number;
  included_seats: number;
  included_ocr: number;
  included_ai: number;
};

export const DEFAULT_PUBLIC_PRICING_PLANS: PublicPricingPlan[] = [
  {
    id: "standard-basic",
    code: "basic",
    name: "基础版",
    monthly_price_cents: 29900,
    annual_price_cents: 299000,
    included_active_streamers: 10,
    included_seats: 5,
    included_ocr: 1000,
    included_ai: 2000,
  },
  {
    id: "standard-pro",
    code: "pro",
    name: "专业版",
    monthly_price_cents: 99900,
    annual_price_cents: 999000,
    included_active_streamers: 30,
    included_seats: 15,
    included_ocr: 5000,
    included_ai: 10000,
  },
  {
    id: "standard-enterprise",
    code: "enterprise",
    name: "旗舰版",
    monthly_price_cents: 299900,
    annual_price_cents: 2999000,
    included_active_streamers: 100,
    included_seats: 50,
    included_ocr: 20000,
    included_ai: 50000,
  },
];

const hiddenPublicPlanCodes = new Set(["trial", "free"]);

export function resolvePublicPricingPlans(
  remotePlans: PublicPricingPlan[] | null | undefined,
): PublicPricingPlan[] {
  const livePaidPlans = (remotePlans ?? []).filter(
    (plan) => !hiddenPublicPlanCodes.has(plan.code) && hasBillablePrice(plan),
  );
  const livePaidByCode = new Map(livePaidPlans.map((plan) => [plan.code, plan]));

  const standardPlans = DEFAULT_PUBLIC_PRICING_PLANS.map((fallback) =>
    clonePlan(livePaidByCode.get(fallback.code) ?? fallback),
  );
  const extraPlans = livePaidPlans
    .filter(
      (plan) =>
        !DEFAULT_PUBLIC_PRICING_PLANS.some(
          (fallback) => fallback.code === plan.code,
        ),
    )
    .sort((a, b) => a.monthly_price_cents - b.monthly_price_cents)
    .map(clonePlan);

  return [...standardPlans, ...extraPlans];
}

function hasBillablePrice(plan: PublicPricingPlan): boolean {
  return plan.monthly_price_cents > 0 && plan.annual_price_cents > 0;
}

function clonePlan(plan: PublicPricingPlan): PublicPricingPlan {
  return { ...plan };
}
