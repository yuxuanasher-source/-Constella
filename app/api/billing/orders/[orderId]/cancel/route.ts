import { NextResponse } from "next/server";

import { cancelBillingOrder } from "@/features/billing/orders-read";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
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
        { error: "Only owner and ops_manager can cancel orders" },
        { status: 403 },
      );
    }

    const { orderId } = await context.params;
    const order = await cancelBillingOrder({
      client: supabase,
      actor: auth,
      orderId,
    });

    return NextResponse.json({ order });
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
