import { NextResponse } from "next/server";
import { z } from "zod";

import { calculateProjectPricing } from "@/features/war-room/pricing-calculator";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { isMcnStaff } from "@/lib/rbac/roles";

const pricingBodySchema = z.object({
  vendorSettlementMethod: z.enum([
    "cpt",
    "fixed_budget",
    "base_salary",
    "base_salary_cpt",
  ]),
  streamerCount: z.number().int().nonnegative(),
  estimatedMinutesPerStreamer: z.number().int().nonnegative(),
  vendorBudgetCents: z.number().int().nullable().optional(),
  vendorHourlyRateCents: z.number().int().nullable().optional(),
  vendorBaseFeeCents: z.number().int().nullable().optional(),
  streamerHourlyCostCents: z.number().int().nullable().optional(),
  streamerBaseCostCents: z.number().int().nullable().optional(),
  supplierCostCents: z.number().int().nullable().optional(),
  expectedManualRevenueCents: z.number().int().nullable().optional(),
  platformFeeBps: z.number().int().nullable().optional(),
  manualAdjustmentCents: z.number().int().nullable().optional(),
  targetMarginBps: z.number().int().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can calculate quote economics" },
        { status: 403 },
      );
    }

    const body = await parseJsonBody(request, pricingBodySchema);
    const pricing = calculateProjectPricing(body);
    return NextResponse.json({ pricing });
  } catch (error) {
    const httpError = toHttpError(error);
    return NextResponse.json(
      { error: httpError.message },
      { status: httpError.status },
    );
  }
}
