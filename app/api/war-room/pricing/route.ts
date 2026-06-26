import { NextResponse } from "next/server";

import {
  calculateProjectPricing,
  type ProjectPricingInput,
} from "@/features/war-room/pricing-calculator";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff } from "@/lib/rbac/roles";

export const POST = withAuth(async ({ auth, request }) => {
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can calculate quote economics" },
      { status: 403 },
    );
  }

  const body = (await request.json()) as ProjectPricingInput;
  const pricing = calculateProjectPricing(body);
  return NextResponse.json({ pricing });
});
