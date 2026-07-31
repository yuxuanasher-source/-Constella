import { NextResponse } from "next/server";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import { toDateString } from "@/features/billing/billing-period";
import { getPaymentProvider } from "@/features/billing/providers/registry";
import { runReconciliation } from "@/features/billing/reconciliation";
import {
  runDunningSweep,
  runExpirePendingOrdersSweep,
  runRenewalSweep,
} from "@/features/billing/subscription-jobs";
import { listStaleUsageReservations } from "@/features/billing/usage-reservations";
import { recordFunnelEvent } from "@/features/funnel/funnel-events";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { sendNotification } from "@/lib/notify/notify";

type RouteContext = {
  params: Promise<{ task: string }>;
};

const STALE_RESERVATION_THRESHOLD_HOURS = 24;
const DEFAULT_STALE_RESERVATION_LIMIT = 100;
const MAX_STALE_RESERVATION_LIMIT = 500;

/**
 * 计费定时任务入口（由外部调度器以 x-cron-secret 触发，service-role 执行）。
 * task: dunning（催缴/宽限/只读）| expire-orders（待支付订单关闭）。
 */
export async function POST(request: Request, context: RouteContext) {
  const secret = process.env.BILLING_CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Scheduled jobs are not configured" },
      { status: 503 },
    );
  }

  try {
    const { task } = await context.params;
    const repo = createSupabaseBillingRepo(admin);

    if (task === "stale-usage-reservations") {
      const requestedLimit = Number(
        new URL(request.url).searchParams.get("limit") ??
          DEFAULT_STALE_RESERVATION_LIMIT,
      );
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(
            1,
            Math.min(Math.trunc(requestedLimit), MAX_STALE_RESERVATION_LIMIT),
          )
        : DEFAULT_STALE_RESERVATION_LIMIT;
      const before = new Date(
        Date.now() - STALE_RESERVATION_THRESHOLD_HOURS * 60 * 60 * 1000,
      ).toISOString();
      const reservations = await listStaleUsageReservations({
        client: admin,
        before,
        limit,
      });

      for (const reservation of reservations) {
        await writeAuditLog(admin, {
          organizationId: reservation.organizationId,
          action: "update",
          module: "billing",
          objectType: "usage_reservation",
          objectId: reservation.reservationId,
          after: {
            reservationId: reservation.reservationId,
            source: reservation.source,
            createdAt: reservation.createdAt,
            ageSeconds: reservation.ageSeconds,
          },
          changedFields: [],
          reason: "stale_usage_reservation_detected",
        });
      }

      return NextResponse.json({
        task,
        summary: {
          before,
          thresholdHours: STALE_RESERVATION_THRESHOLD_HOURS,
          limit,
          staleCount: reservations.length,
          organizationCount: new Set(
            reservations.map((reservation) => reservation.organizationId),
          ).size,
          oldestAgeSeconds: reservations.reduce(
            (oldest, reservation) =>
              Math.max(oldest, reservation.ageSeconds),
            0,
          ),
        },
      });
    }

    if (task === "dunning") {
      const summary = await runDunningSweep({
        repo,
        hooks: {
          async onPastDue(subscription, cause, graceUntil) {
            await sendNotification(admin, {
              organizationId: subscription.organizationId,
              recipientRole: "owner",
              type: "system",
              title: cause === "trial_expired" ? "试用已到期" : "订阅已欠费",
              content:
                "您的订阅已进入宽限期，请在宽限期内完成续费，避免功能受限。",
              source: "billing.dunning",
              isHighRisk: false,
            });
            await writeAuditLog(admin, {
              organizationId: subscription.organizationId,
              action: "update",
              module: "billing",
              objectType: "organization_subscription",
              after: { status: "past_due", cause, graceUntil },
              changedFields: ["status"],
            });
            if (cause === "trial_expired") {
              await recordFunnelEvent(admin, {
                event: "trial_expired",
                organizationId: subscription.organizationId,
              });
            }
          },
          async onReadonly(subscription) {
            await sendNotification(admin, {
              organizationId: subscription.organizationId,
              recipientRole: "owner",
              type: "system",
              title: "订阅已转为只读",
              content: "宽限期已过，账户进入只读状态，付费后立即恢复。",
              source: "billing.dunning",
            });
            await writeAuditLog(admin, {
              organizationId: subscription.organizationId,
              action: "update",
              module: "billing",
              objectType: "organization_subscription",
              after: { status: "readonly" },
              changedFields: ["status"],
            });
          },
        },
      });
      return NextResponse.json({ task, summary });
    }

    if (task === "renewals") {
      const summary = await runRenewalSweep({
        repo,
        hooks: {
          async onRenewalOrder(subscription, order) {
            await sendNotification(admin, {
              organizationId: subscription.organizationId,
              recipientRole: "owner",
              type: "system",
              title: "订阅续费提醒",
              content:
                "已为您生成续费订单，请在到期前完成支付以保持服务不中断。",
              objectType: "billing_order",
              objectId: order.id,
              source: "billing.renewal",
            });
          },
        },
      });
      return NextResponse.json({ task, summary });
    }

    if (task === "expire-orders") {
      const summary = await runExpirePendingOrdersSweep({ repo });
      return NextResponse.json({ task, summary });
    }

    if (task === "reconcile") {
      const date =
        new URL(request.url).searchParams.get("date") ?? toDateString(new Date());
      const summary = await runReconciliation({
        repo,
        provider: getPaymentProvider(),
        date,
      });
      return NextResponse.json({ task, date, summary });
    }

    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
