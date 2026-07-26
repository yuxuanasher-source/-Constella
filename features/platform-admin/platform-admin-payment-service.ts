import { randomUUID } from "node:crypto";

import { applyPaidOrder } from "@/features/billing/apply-paid-order";
import type {
  BillingRepo,
  OrderRecord,
} from "@/features/billing/billing-repo";
import type { BillingCycle, BillingOrderKind } from "@/features/billing/order-types";
import type { PaymentProvider } from "@/features/billing/providers/payment-provider";
import {
  requestRefundCore,
  settleRefund,
} from "@/features/billing/refunds";

import type { PlatformAdminContext } from "./platform-admin-auth";
import type { OrganizationLifecycleStatus } from "./platform-admin-contracts";
import {
  PlatformAdminConflictError,
  PlatformAdminProviderUnavailableError,
  PlatformAdminValidationError,
} from "./platform-admin-errors";
import { executePlatformAdminOperation } from "./platform-admin-mutations";
import type { PlatformAdminOperationLog } from "./platform-admin-operation-log";

type OfflinePaymentPurpose = Extract<
  BillingOrderKind,
  | "subscription_new"
  | "subscription_renewal"
  | "subscription_upgrade"
  | "subscription_downgrade"
>;

export type PlatformAdminOrderRecord = OrderRecord & {
  updatedAt: string;
};

export type PlatformAdminPaymentRepository = BillingRepo & {
  operationLog: PlatformAdminOperationLog;
  getOrganizationForPayment(organizationId: string): Promise<{
    id: string;
    lifecycleStatus: OrganizationLifecycleStatus;
  } | null>;
  getTransactionByProviderReference(
    provider: string,
    reference: string,
  ): Promise<{
    id: string;
    orderId: string;
    type: "payment" | "refund";
    status: "created" | "succeeded" | "failed";
    amountCents: number;
  } | null>;
  getAdminOrder(orderId: string): Promise<PlatformAdminOrderRecord | null>;
  cancelPendingOrder(
    orderId: string,
    expectedUpdatedAt: string,
  ): Promise<PlatformAdminOrderRecord | null>;
};

export type PlatformPaymentMutationResult = {
  orderId: string;
  transactionId: string;
  status: "paid" | "refunding" | "refunded";
  appliedSubscriptionStatus: string | null;
  traceId: string;
};

export async function recordPlatformOfflinePayment(input: {
  repo: PlatformAdminPaymentRepository;
  actor: PlatformAdminContext;
  organizationId: string;
  command: {
    purpose: OfflinePaymentPurpose;
    planId: string;
    billingCycle: BillingCycle;
    amountCents: number;
    currency: string;
    receivedAt: string;
    externalReference: string;
    channel: string;
    reason: string;
    idempotencyKey: string;
  };
  now?: Date;
}): Promise<PlatformPaymentMutationResult> {
  const command = normalizeOfflinePayment(input.command);
  const organization = await input.repo.getOrganizationForPayment(
    input.organizationId,
  );
  if (!organization) {
    throw new PlatformAdminValidationError("Organization not found.");
  }
  if (organization.lifecycleStatus === "archived") {
    throw new PlatformAdminValidationError(
      "Archived organizations cannot receive new payments.",
    );
  }
  const plan = await input.repo.getPlanById(command.planId);
  if (!plan) {
    throw new PlatformAdminValidationError("Billing plan not found.");
  }
  const traceId = randomUUID();

  return executePlatformAdminOperation({
    actor: input.actor,
    action: "payment.offline.record",
    target: {
      type: "billing_order",
      organizationId: input.organizationId,
    },
    reason: command.reason,
    highRisk: true,
    idempotencyKey: command.idempotencyKey,
    request: {
      organizationId: input.organizationId,
      ...command,
    },
    loadBefore: async () => ({
      organizationId: organization.id,
      lifecycleStatus: organization.lifecycleStatus,
    }),
    execute: async () => {
      let order = await input.repo.findOrderByIdempotencyKey(
        input.organizationId,
        command.idempotencyKey,
      );
      if (order) {
        assertMatchingOfflineOrder(order, command, plan.code);
      } else {
        order = await input.repo.insertOrder({
          organizationId: input.organizationId,
          kind: command.purpose,
          amountCents: command.amountCents,
          currency: command.currency,
          target: {
            planCode: plan.code,
            billingCycle: command.billingCycle,
          },
          planId: plan.id,
          billingCycle: command.billingCycle,
          idempotencyKey: command.idempotencyKey,
          provider: "offline",
          paidAt: command.receivedAt,
          createdBy: input.actor.userId,
        });
      }

      if (order.status === "pending") {
        const transition = await input.repo.markOrderPaid(
          order.id,
          command.receivedAt,
        );
        if (!transition.transitioned) {
          const current = await input.repo.getOrderById(order.id);
          if (current?.status !== "paid") {
            throw new PlatformAdminConflictError(
              "The offline order changed while payment was recorded.",
            );
          }
          order = current;
        } else {
          order = {
            ...order,
            status: "paid",
            paidAt: command.receivedAt,
          };
        }
      } else if (order.status !== "paid") {
        throw new PlatformAdminValidationError(
          `Offline payment cannot be applied to an order in ${order.status} state.`,
        );
      }

      const existingTransaction =
        await input.repo.getTransactionByProviderReference(
          "offline",
          command.externalReference,
        );
      if (
        existingTransaction &&
        (existingTransaction.orderId !== order.id ||
          existingTransaction.type !== "payment" ||
          existingTransaction.amountCents !== command.amountCents)
      ) {
        throw new PlatformAdminConflictError(
          "The offline external reference is already linked to another payment.",
        );
      }
      if (!existingTransaction) {
        await input.repo.insertTransaction({
          organizationId: input.organizationId,
          orderId: order.id,
          type: "payment",
          status: "succeeded",
          amountCents: command.amountCents,
          provider: "offline",
          providerTxnId: command.externalReference,
          providerPayload: {
            source: "platform_admin",
            channel: command.channel,
            receivedAt: command.receivedAt,
          },
          succeededAt: command.receivedAt,
        });
      }

      const beforeSubscription = await input.repo.getSubscription(
        input.organizationId,
      );
      const applyResult =
        beforeSubscription?.lastOrderId === order.id
          ? {
              applied: false,
              subscriptionStatus: beforeSubscription.status,
            }
          : await applyPaidOrder({
              repo: input.repo,
              order,
              now: input.now ?? new Date(command.receivedAt),
            });
      const transaction =
        existingTransaction ??
        (await input.repo.getTransactionByProviderReference(
          "offline",
          command.externalReference,
        ));
      if (!transaction) {
        throw new Error("Offline payment transaction was not persisted.");
      }
      return {
        orderId: order.id,
        transactionId: transaction.id,
        status: "paid" as const,
        appliedSubscriptionStatus:
          applyResult.subscriptionStatus ??
          (await input.repo.getSubscription(input.organizationId))?.status ??
          null,
        traceId,
      };
    },
    summarizeAfter: paymentResultSnapshot,
    log: input.repo.operationLog,
    traceId,
  });
}

export async function refundPlatformOrder(input: {
  repo: PlatformAdminPaymentRepository;
  actor: PlatformAdminContext;
  orderId: string;
  command: {
    amountCents: number;
    refundExternalReference: string;
    reason: string;
    idempotencyKey: string;
  };
  providerResolver: (name: string) => PaymentProvider;
  now?: Date;
}): Promise<PlatformPaymentMutationResult> {
  const order = await requireAdminOrder(input.repo, input.orderId);
  const reason = input.command.reason.trim();
  const refundExternalReference =
    input.command.refundExternalReference.trim();
  if (!reason) {
    throw new PlatformAdminValidationError("Refund requires a reason.");
  }
  if (!refundExternalReference) {
    throw new PlatformAdminValidationError(
      "Refund external reference is required.",
    );
  }
  if (
    !Number.isInteger(input.command.amountCents) ||
    input.command.amountCents <= 0
  ) {
    throw new PlatformAdminValidationError(
      "Refund amount must be a positive integer.",
    );
  }
  const traceId = randomUUID();

  return executePlatformAdminOperation({
    actor: input.actor,
    action: "payment.refund",
    target: {
      type: "billing_order",
      id: order.id,
      organizationId: order.organizationId,
    },
    reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      orderId: order.id,
      amountCents: input.command.amountCents,
      refundExternalReference,
    },
    loadBefore: async () => orderSnapshot(order),
    execute: async () => {
      const payment = await input.repo.getOrderPaymentTransaction(order.id);
      if (!payment?.providerTxnId) {
        throw new PlatformAdminValidationError(
          "No settled payment transaction to refund.",
        );
      }
      let provider: PaymentProvider;
      try {
        provider = input.providerResolver(payment.provider);
      } catch {
        throw new PlatformAdminProviderUnavailableError(
          `Payment provider ${payment.provider} is unavailable.`,
        );
      }
      const existingRefund =
        await input.repo.getTransactionByProviderReference(
          provider.name,
          refundExternalReference,
        );
      if (
        existingRefund &&
        (existingRefund.orderId !== order.id ||
          existingRefund.type !== "refund" ||
          existingRefund.amountCents !== input.command.amountCents)
      ) {
        throw new PlatformAdminConflictError(
          "The refund external reference is already linked to another transaction.",
        );
      }

      let refund: {
        orderId: string;
        status: "refunding" | "refunded";
        refundTxnId: string;
      };
      if (existingRefund?.status === "succeeded") {
        if (order.status === "paid") {
          await input.repo.updateOrder(order.id, { status: "refunding" });
        }
        if (order.status === "paid" || order.status === "refunding") {
          await settleRefund({
            repo: input.repo,
            order: { ...order, status: "refunding" },
            now: input.now,
          });
        }
        refund = {
          orderId: order.id,
          status: "refunded",
          refundTxnId: refundExternalReference,
        };
      } else {
        if (existingRefund) {
          throw new PlatformAdminValidationError(
            "The existing refund transaction did not succeed.",
          );
        }
        try {
          refund = await requestRefundCore({
            repo: input.repo,
            provider,
            organizationId: order.organizationId,
            orderId: order.id,
            amountCents: input.command.amountCents,
            refundExternalReference,
            reason,
            now: input.now,
          });
        } catch (error) {
          if (isRefundBusinessRuleError(error)) {
            throw new PlatformAdminValidationError(error.message);
          }
          throw error;
        }
      }
      const transaction =
        await input.repo.getTransactionByProviderReference(
          provider.name,
          refund.refundTxnId,
        );
      if (!transaction) {
        throw new Error("Refund transaction was not persisted.");
      }
      return {
        orderId: order.id,
        transactionId: transaction.id,
        status: refund.status,
        appliedSubscriptionStatus:
          (await input.repo.getSubscription(order.organizationId))?.status ??
          null,
        traceId,
      };
    },
    summarizeAfter: paymentResultSnapshot,
    log: input.repo.operationLog,
    traceId,
  });
}

export async function cancelPlatformOrder(input: {
  repo: PlatformAdminPaymentRepository;
  actor: PlatformAdminContext;
  orderId: string;
  command: {
    expectedUpdatedAt: string;
    reason: string;
    idempotencyKey: string;
  };
}) {
  const order = await requireAdminOrder(input.repo, input.orderId);
  return executePlatformAdminOperation({
    actor: input.actor,
    action: "payment.order.cancel",
    target: {
      type: "billing_order",
      id: order.id,
      organizationId: order.organizationId,
    },
    reason: input.command.reason,
    highRisk: true,
    idempotencyKey: input.command.idempotencyKey,
    request: {
      orderId: order.id,
      expectedUpdatedAt: input.command.expectedUpdatedAt,
    },
    loadBefore: async () => orderSnapshot(order),
    execute: async () => {
      if (order.status === "paid") {
        throw new PlatformAdminValidationError(
          "Paid orders require a refund and cannot be cancelled.",
        );
      }
      if (order.status !== "pending") {
        throw new PlatformAdminValidationError(
          "Only pending orders can be cancelled.",
        );
      }
      const cancelled = await input.repo.cancelPendingOrder(
        order.id,
        input.command.expectedUpdatedAt,
      );
      if (!cancelled) {
        throw new PlatformAdminConflictError(
          "The order changed after it was loaded. Refresh and try again.",
        );
      }
      return cancelled;
    },
    summarizeAfter: orderSnapshot,
    log: input.repo.operationLog,
  });
}

function normalizeOfflinePayment(
  command: Parameters<typeof recordPlatformOfflinePayment>[0]["command"],
) {
  const normalized = {
    ...command,
    currency: command.currency.trim().toUpperCase(),
    externalReference: command.externalReference.trim(),
    channel: command.channel.trim(),
    reason: command.reason.trim(),
    idempotencyKey: command.idempotencyKey.trim(),
  };
  if (!normalized.externalReference) {
    throw new PlatformAdminValidationError(
      "Offline payment external reference is required.",
    );
  }
  if (
    !normalized.channel ||
    !normalized.reason ||
    !normalized.idempotencyKey
  ) {
    throw new PlatformAdminValidationError(
      "Offline payment channel, reason, and idempotency key are required.",
    );
  }
  if (!Number.isInteger(normalized.amountCents) || normalized.amountCents <= 0) {
    throw new PlatformAdminValidationError(
      "Offline payment amount must be a positive integer.",
    );
  }
  if (!/^[A-Z]{3}$/.test(normalized.currency)) {
    throw new PlatformAdminValidationError(
      "Offline payment currency must be a three-letter code.",
    );
  }
  if (!Number.isFinite(new Date(normalized.receivedAt).getTime())) {
    throw new PlatformAdminValidationError(
      "Offline payment received date is invalid.",
    );
  }
  return normalized;
}

function assertMatchingOfflineOrder(
  order: OrderRecord,
  command: ReturnType<typeof normalizeOfflinePayment>,
  planCode: string,
) {
  if (
    order.kind !== command.purpose ||
    order.amountCents !== command.amountCents ||
    order.currency !== command.currency ||
    order.planId !== command.planId ||
    order.billingCycle !== command.billingCycle ||
    order.target.planCode !== planCode
  ) {
    throw new PlatformAdminConflictError(
      "The payment idempotency key is already linked to a different order.",
    );
  }
}

async function requireAdminOrder(
  repo: PlatformAdminPaymentRepository,
  orderId: string,
) {
  const order = await repo.getAdminOrder(orderId);
  if (!order) {
    throw new PlatformAdminValidationError("Billing order not found.");
  }
  return order;
}

function orderSnapshot(
  order: PlatformAdminOrderRecord,
): Record<string, unknown> {
  return { ...order };
}

function paymentResultSnapshot(
  result: PlatformPaymentMutationResult,
): Record<string, unknown> {
  return { ...result };
}

function isRefundBusinessRuleError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /reason|order not found|paid orders|refundable|settled payment|already consumed|refund amount/i.test(
      error.message,
    )
  );
}
