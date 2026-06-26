import { NextResponse } from "next/server";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

type PlanRow = {
  id: string;
  code: string;
  tier: string;
  name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  included_active_streamers: number;
  included_seats: number;
  included_ocr: number;
  included_ai: number;
  included_storage_mb: number;
  included_exports: number;
  features: Record<string, unknown> | null;
};

type PriceRow = {
  plan_id: string;
  billing_cycle: "monthly" | "annual";
  price_cents: number;
  currency: string;
  active: boolean;
};

/**
 * 公开套餐 + 当前价格版本（漏斗 / 套餐页可匿名读）。
 * 用 service-role 读参考数据并返回安全投影，不暴露任何组织 / 经济敏感数据。
 */
export async function GET() {
  try {
    const client = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
    if (!client) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const { data: plans, error: plansError } = await client
      .from("billing_plans")
      .select(
        "id, code, tier, name, monthly_price_cents, annual_price_cents, included_active_streamers, included_seats, included_ocr, included_ai, included_storage_mb, included_exports, features",
      )
      .order("monthly_price_cents", { ascending: true })
      .returns<PlanRow[]>();
    if (plansError) {
      throw plansError;
    }

    const { data: prices } = await client
      .from("billing_plan_prices")
      .select("plan_id, billing_cycle, price_cents, currency, active")
      .eq("active", true)
      .returns<PriceRow[]>();

    const pricesByPlan = new Map<string, PriceRow[]>();
    for (const price of prices ?? []) {
      pricesByPlan.set(price.plan_id, [
        ...(pricesByPlan.get(price.plan_id) ?? []),
        price,
      ]);
    }

    const payload = (plans ?? [])
      .filter((plan) => plan.code !== "trial")
      .map((plan) => ({
        code: plan.code,
        tier: plan.tier,
        name: plan.name,
        prices: (pricesByPlan.get(plan.id) ?? []).map((price) => ({
          billingCycle: price.billing_cycle,
          priceCents: price.price_cents,
          currency: price.currency,
        })),
        included: {
          activeStreamers: plan.included_active_streamers,
          seats: plan.included_seats,
          ocr: plan.included_ocr,
          ai: plan.included_ai,
          storageMb: plan.included_storage_mb,
          exports: plan.included_exports,
        },
        features: plan.features ?? {},
      }));

    return NextResponse.json({ plans: payload });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
