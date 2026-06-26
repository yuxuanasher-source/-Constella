import { NextResponse } from "next/server";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import { parseCheckoutIntent } from "@/features/billing/checkout-intent";
import { createCheckoutOrder } from "@/features/billing/checkout";
import { getPaymentProvider } from "@/features/billing/providers/registry";
import { recordFunnelEvent } from "@/features/funnel/funnel-events";
import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

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

    if (auth.role !== "owner" && auth.role !== "ops_manager") {
      return NextResponse.json(
        { error: "Only owner and ops_manager can create checkout orders" },
        { status: 403 },
      );
    }

    const intent = parseCheckoutIntent(await request.json());
    const repo = createSupabaseBillingRepo(supabase);
    const provider = getPaymentProvider();

    const result = await createCheckoutOrder({
      repo,
      provider,
      actor: auth,
      intent,
      audit: (input) => writeAuditLog(supabase, input),
    });

    await recordFunnelEvent(supabase, {
      event: "checkout_started",
      organizationId: auth.organizationId,
      userId: auth.userId,
      properties: { kind: intent.kind, orderId: result.order.id },
    }).catch(() => undefined);

    return NextResponse.json({
      order: {
        id: result.order.id,
        kind: result.order.kind,
        status: result.order.status,
        amountCents: result.order.amountCents,
        currency: result.order.currency,
        billingCycle: result.order.billingCycle ?? null,
        expiresAt: result.order.expiresAt ?? null,
      },
      pay: {
        provider: result.provider,
        providerTxnId: result.providerTxnId,
        params: result.payParams,
      },
      reused: result.reused,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
