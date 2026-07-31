import { NextResponse } from "next/server";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import {
  getPaymentProvider,
  PaymentProviderUnavailableError,
} from "@/features/billing/providers/registry";
import type { WebhookBusinessInvariantReason } from "@/features/billing/webhooks";
import { handleWebhook } from "@/features/billing/webhooks";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

const BUSINESS_INVARIANT_REJECTIONS =
  new Set<WebhookBusinessInvariantReason>([
    "amount_mismatch",
    "provider_mismatch",
    "invalid_provider_transaction",
  ]);

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

    if (!result.processed && result.verificationFailed) {
      return NextResponse.json(
        { error: "Invalid webhook" },
        { status: 400 },
      );
    }

    if (
      !result.processed &&
      result.reason &&
      BUSINESS_INVARIANT_REJECTIONS.has(
        result.reason as WebhookBusinessInvariantReason,
      )
    ) {
      return NextResponse.json({ processed: false });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return NextResponse.json(
        { error: "Payment provider unavailable" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
