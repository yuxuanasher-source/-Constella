import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createMemoryBillingRepo } from "@/features/billing/billing-repo-memory";
import { getPaymentProvider } from "@/features/billing/providers/registry";

import type { PlatformAdminContext } from "./platform-admin-auth";
import { PlatformAdminValidationError } from "./platform-admin-errors";
import {
  cancelPlatformOrder,
  recordPlatformOfflinePayment,
  refundPlatformOrder,
  type PlatformAdminPaymentRepository,
} from "./platform-admin-payment-service";
import type {
  ExistingPlatformAdminOperation,
  PlatformAdminOperationLogEntry,
} from "./platform-admin-operation-log";

const actor: PlatformAdminContext = {
  userId: "admin-user",
  email: "admin@example.com",
  name: "平台管理员",
  role: "super_admin",
};

const plans = [
  {
    id: "plan-free",
    code: "free",
    tier: "free" as const,
    name: "免费版",
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    includedActiveStreamers: 1,
    includedSeats: 1,
    includedOcr: 0,
    includedAi: 0,
    includedStorageMb: 100,
    includedExports: 0,
  },
  {
    id: "plan-pro",
    code: "pro",
    tier: "pro" as const,
    name: "专业版",
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    includedActiveStreamers: 30,
    includedSeats: 10,
    includedOcr: 1000,
    includedAi: 500,
    includedStorageMb: 10240,
    includedExports: 100,
  },
];

function createPaymentRepo() {
  const { repo, state } = createMemoryBillingRepo({
    plans,
    subscription: {
      organizationId: "org-1",
      planId: "plan-free",
      status: "active",
      billingCycle: "monthly",
      currentPeriodStart: "2026-07-01",
      currentPeriodEnd: "2026-08-01",
      pendingPlanId: null,
      pendingBillingCycle: null,
      autoRenew: true,
      lastOrderId: null,
    },
  });
  const logs = new Map<string, ExistingPlatformAdminOperation>();
  const paymentRepo = Object.assign(repo, {
    operationLog: {
      findByIdempotency: vi.fn(
        async ({
          actorUserId,
          idempotencyKey,
        }: {
          actorUserId: string;
          idempotencyKey: string;
        }) => logs.get(`${actorUserId}:${idempotencyKey}`) ?? null,
      ),
      write: vi.fn(async (entry: PlatformAdminOperationLogEntry) => {
        if (entry.idempotencyKey) {
          logs.set(`${entry.actorUserId}:${entry.idempotencyKey}`, {
            requestHash: entry.requestHash,
            result: entry.result,
            resultValue: entry.resultValue,
          });
        }
      }),
    },
    getOrganizationForPayment: vi.fn(async (organizationId: string) =>
      organizationId === "org-1"
        ? { id: "org-1", lifecycleStatus: "active" as const }
        : null,
    ),
    getTransactionByProviderReference: vi.fn(
      async (provider: string, reference: string) => {
        const index = state.transactions.findIndex(
          (transaction) =>
            transaction.provider === provider &&
            transaction.providerTxnId === reference,
        );
        const transaction = state.transactions[index];
        return transaction
          ? {
              id: transaction.id ?? `txn-${index + 1}`,
              orderId: transaction.orderId,
              type: transaction.type,
              status: transaction.status,
              amountCents: transaction.amountCents,
            }
          : null;
      },
    ),
    getAdminOrder: vi.fn(async (orderId: string) => {
      const order = await repo.getOrderById(orderId);
      return order
        ? { ...order, updatedAt: "2026-07-26T08:00:00.000Z" }
        : null;
    }),
    cancelPendingOrder: vi.fn(
      async (orderId: string) => {
        const order = await repo.getOrderById(orderId);
        if (!order || order.status !== "pending") {
          return null;
        }
        await repo.updateOrder(orderId, { status: "cancelled" });
        return {
          ...order,
          status: "cancelled" as const,
          updatedAt: "2026-07-26T09:00:00.000Z",
        };
      },
    ),
  }) as PlatformAdminPaymentRepository;
  return { repo: paymentRepo, state };
}

const paymentCommand = {
  purpose: "subscription_new" as const,
  planId: "plan-pro",
  billingCycle: "monthly" as const,
  amountCents: 29900,
  currency: "CNY",
  receivedAt: "2026-07-26T08:00:00.000Z",
  externalReference: "BANK-20260726-001",
  channel: "bank_transfer",
  reason: "确认收到客户对公转账",
  idempotencyKey: "offline-payment-1",
};

describe("recordPlatformOfflinePayment", () => {
  it("requires the complete offline receipt evidence", async () => {
    const { repo } = createPaymentRepo();

    await expect(
      recordPlatformOfflinePayment({
        repo,
        actor,
        organizationId: "org-1",
        command: { ...paymentCommand, externalReference: " " },
      }),
    ).rejects.toThrow("external reference");
  });

  it("creates one paid order and succeeded transaction, then applies the subscription once", async () => {
    const { repo, state } = createPaymentRepo();

    const first = await recordPlatformOfflinePayment({
      repo,
      actor,
      organizationId: "org-1",
      command: paymentCommand,
      now: new Date("2026-07-26T08:00:00.000Z"),
    });
    const second = await recordPlatformOfflinePayment({
      repo,
      actor,
      organizationId: "org-1",
      command: paymentCommand,
      now: new Date("2026-07-26T08:00:00.000Z"),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "paid",
      appliedSubscriptionStatus: "active",
    });
    expect(state.orders.size).toBe(1);
    expect(
      state.transactions.filter(
        (transaction) => transaction.type === "payment",
      ),
    ).toHaveLength(1);
    expect(state.subscriptions.get("org-1")).toMatchObject({
      planId: "plan-pro",
      lastOrderId: first.orderId,
    });
  });
});

describe("refundPlatformOrder and cancellation", () => {
  it("records a succeeded refund, deducts net revenue, and rolls business effects back once", async () => {
    const { repo, state } = createPaymentRepo();
    const payment = await recordPlatformOfflinePayment({
      repo,
      actor,
      organizationId: "org-1",
      command: paymentCommand,
      now: new Date("2026-07-26T08:00:00.000Z"),
    });

    const result = await refundPlatformOrder({
      repo,
      actor,
      orderId: payment.orderId,
      command: {
        amountCents: 29900,
        refundExternalReference: "BANK-REFUND-20260726-001",
        reason: "客户在服务开通前取消",
        idempotencyKey: "refund-1",
      },
      providerResolver: (name) => getPaymentProvider(name),
      now: new Date("2026-07-26T09:00:00.000Z"),
    });

    expect(result.status).toBe("refunded");
    expect(
      state.transactions
        .filter((transaction) => transaction.status === "succeeded")
        .reduce(
          (total, transaction) =>
            total +
            (transaction.type === "payment"
              ? transaction.amountCents
              : -transaction.amountCents),
          0,
        ),
    ).toBe(0);
    expect(state.subscriptions.get("org-1")).toMatchObject({
      status: "cancelled",
      planId: "plan-free",
    });
  });

  it("cancels pending orders but tells paid orders to use refund", async () => {
    const { repo } = createPaymentRepo();
    const pending = await repo.insertOrder({
      id: "order-pending",
      organizationId: "org-1",
      kind: "subscription_new",
      amountCents: 29900,
      currency: "CNY",
      target: { planCode: "pro", billingCycle: "monthly" },
      planId: "plan-pro",
      billingCycle: "monthly",
      idempotencyKey: "pending-1",
      createdBy: actor.userId,
    });

    await expect(
      cancelPlatformOrder({
        repo,
        actor,
        orderId: pending.id,
        command: {
          expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
          reason: "重复录入",
          idempotencyKey: "cancel-1",
        },
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    const paid = await recordPlatformOfflinePayment({
      repo,
      actor,
      organizationId: "org-1",
      command: paymentCommand,
    });
    await expect(
      cancelPlatformOrder({
        repo,
        actor,
        orderId: paid.orderId,
        command: {
          expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
          reason: "客户取消",
          idempotencyKey: "cancel-paid",
        },
      }),
    ).rejects.toThrow("refund");
  });

  it("classifies an invalid refundable amount as a business-rule failure", async () => {
    const { repo } = createPaymentRepo();
    const payment = await recordPlatformOfflinePayment({
      repo,
      actor,
      organizationId: "org-1",
      command: paymentCommand,
    });

    await expect(
      refundPlatformOrder({
        repo,
        actor,
        orderId: payment.orderId,
        command: {
          amountCents: 1,
          refundExternalReference: "BANK-REFUND-WRONG-AMOUNT",
          reason: "错误金额",
          idempotencyKey: "refund-wrong-amount",
        },
        providerResolver: (name) => getPaymentProvider(name),
      }),
    ).rejects.toBeInstanceOf(PlatformAdminValidationError);
  });

  it("does not reference streamer settlement storage", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "features/platform-admin/platform-admin-payment-service.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /streamer_settlement|settlement_records|settlement_items/i,
    );
  });
});
