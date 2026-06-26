import { NextResponse } from "next/server";

import { getBillingStatus } from "@/features/billing/billing-status";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff } from "@/lib/rbac/roles";

export const GET = withAuth(async ({ supabase, auth }) => {
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can view billing status" },
      { status: 403 },
    );
  }

  const billing = await getBillingStatus({
    client: supabase,
    organizationId: auth.organizationId,
  });

  return NextResponse.json({ billing });
});
