import { NextResponse } from "next/server";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import { getPaymentProvider } from "@/features/billing/providers/registry";
import { requestRefund } from "@/features/billing/refunds";
import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { sendNotification } from "@/lib/notify/notify";

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

    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "Only owners can request refunds" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    if (!reason.trim()) {
      return NextResponse.json({ error: "Refund requires a reason" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Billing service is unavailable" },
        { status: 503 },
      );
    }

    const result = await requestRefund({
      repo: createSupabaseBillingRepo(admin),
      provider: getPaymentProvider(),
      actor: auth,
      orderId,
      reason,
      audit: (input) => writeAuditLog(supabase, input),
      notify: async (order, settled) => {
        await sendNotification(supabase, {
          organizationId: auth.organizationId,
          recipientRole: "owner",
          type: "high_risk",
          title: settled ? "退款已完成" : "退款处理中",
          content: `订单 ${order.id} 的退款${settled ? "已成功" : "已发起，处理中"}。`,
          objectType: "billing_order",
          objectId: order.id,
          isHighRisk: true,
        });
      },
    });

    return NextResponse.json({ refund: result });
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
