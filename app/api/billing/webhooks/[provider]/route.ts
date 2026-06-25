import { NextResponse } from "next/server";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import { getPaymentProvider } from "@/features/billing/providers/registry";
import { handleWebhook } from "@/features/billing/webhooks";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

/**
 * 渠道异步回调入口。验签 + 幂等在 handleWebhook 内完成；
 * 用 service-role admin client（无用户会话），未验签事件只落库不处理（返回 400）。
 */
export async function POST(request: Request, context: RouteContext) {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Webhook processing is not configured" },
      { status: 503 },
    );
  }

  try {
    const { provider: providerName } = await context.params;
    const provider = getPaymentProvider(providerName);
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-billing-signature") ??
      request.headers.get("x-mock-signature") ??
      undefined;

    const result = await handleWebhook({
      repo: createSupabaseBillingRepo(admin),
      provider,
      rawBody,
      signature,
      audit: (input) => writeAuditLog(admin, input),
    });

    if (!result.processed && result.reason === "signature_mismatch") {
      return NextResponse.json(
        { processed: false, reason: result.reason },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
