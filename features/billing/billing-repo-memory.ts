import { randomUUID } from "node:crypto";

import type {
  BillingRepo,
  NewOrderInput,
  OrderRecord,
  PlanRecord,
  SubscriptionRecord,
  TransactionInput,
  WebhookEventInput,
} from "./billing-repo";
import type { PlanPriceRow } from "./pricing";

export type MemoryWebhookEvent = WebhookEventInput & { processed: boolean };

export type MemoryBillingState = {
  plans: PlanRecord[];
  prices: Map<string, PlanPriceRow[]>;
  subscriptions: Map<string, SubscriptionRecord>;
  orders: Map<string, OrderRecord>;
  transactions: TransactionInput[];
  webhookEvents: Map<string, MemoryWebhookEvent>;
  usageCounters: Map<
    string,
    { includedQuantity: number; addonQuantity: number; usedQuantity: number }
  >;
  usageAddons: Array<{ organizationId: string; metric: string; quantity: number }>;
  featureAddons: Map<string, { featureKey: string; enabled: boolean }>;
};

/**
 * 内存版计费数据访问层，用于幂等 / 状态机 / 并发回调的确定性单元测试。
 */
export function createMemoryBillingRepo(seed: {
  plans?: PlanRecord[];
  prices?: Record<string, PlanPriceRow[]>;
  subscription?: SubscriptionRecord | null;
}): { repo: BillingRepo; state: MemoryBillingState } {
  const state: MemoryBillingState = {
    plans: seed.plans ?? [],
    prices: new Map(Object.entries(seed.prices ?? {})),
    subscriptions: new Map(),
    orders: new Map(),
    transactions: [],
    webhookEvents: new Map(),
    usageCounters: new Map(),
    usageAddons: [],
    featureAddons: new Map(),
  };
  if (seed.subscription) {
    state.subscriptions.set(seed.subscription.organizationId, {
      ...seed.subscription,
    });
  }

  const counterKey = (org: string, metric: string, period: string) =>
    `${org}:${metric}:${period}`;

  const repo: BillingRepo = {
    async getPlanByCode(code) {
      return state.plans.find((plan) => plan.code === code) ?? null;
    },
    async getPlanById(id) {
      return state.plans.find((plan) => plan.id === id) ?? null;
    },
    async getPlanPrices(planId) {
      return state.prices.get(planId) ?? [];
    },
    async getPlanPriceId(planId, cycle) {
      const match = (state.prices.get(planId) ?? []).find(
        (price) => price.active && price.billingCycle === cycle,
      );
      return match ? `price_${planId}_${cycle}` : null;
    },
    async getSubscription(organizationId) {
      return state.subscriptions.get(organizationId) ?? null;
    },
    async updateSubscription(organizationId, patch) {
      const current = state.subscriptions.get(organizationId);
      if (!current) {
        throw new Error("Subscription not found");
      }
      state.subscriptions.set(organizationId, { ...current, ...patch });
    },
    async listLifecycleSubscriptions() {
      return [...state.subscriptions.values()].filter((sub) =>
        ["trialing", "active", "past_due"].includes(sub.status),
      );
    },
    async listPendingOrders() {
      return [...state.orders.values()].filter(
        (order) => order.status === "pending",
      );
    },
    async findOrderByIdempotencyKey(organizationId, idempotencyKey) {
      for (const order of state.orders.values()) {
        if (
          order.organizationId === organizationId &&
          order.idempotencyKey === idempotencyKey
        ) {
          return order;
        }
      }
      return null;
    },
    async getOrderById(orderId) {
      return state.orders.get(orderId) ?? null;
    },
    async insertOrder(input: NewOrderInput) {
      const order: OrderRecord = {
        id: input.id ?? randomUUID(),
        organizationId: input.organizationId,
        kind: input.kind,
        status: input.status ?? "pending",
        amountCents: input.amountCents,
        currency: input.currency,
        target: input.target,
        planId: input.planId ?? null,
        planPriceId: input.planPriceId ?? null,
        billingCycle: input.billingCycle ?? null,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider ?? null,
        expiresAt: input.expiresAt ?? null,
        paidAt: null,
        createdBy: input.createdBy,
      };
      for (const existing of state.orders.values()) {
        if (
          existing.organizationId === order.organizationId &&
          existing.idempotencyKey === order.idempotencyKey
        ) {
          throw new Error("duplicate idempotency_key");
        }
      }
      state.orders.set(order.id, order);
      return order;
    },
    async updateOrder(orderId, patch) {
      const current = state.orders.get(orderId);
      if (!current) {
        throw new Error("Order not found");
      }
      state.orders.set(orderId, { ...current, ...patch });
    },
    async markOrderPaid(orderId, paidAt) {
      const current = state.orders.get(orderId);
      if (!current || current.status !== "pending") {
        return { transitioned: false };
      }
      state.orders.set(orderId, { ...current, status: "paid", paidAt });
      return { transitioned: true };
    },
    async insertTransaction(input: TransactionInput) {
      if (input.providerTxnId) {
        const index = state.transactions.findIndex(
          (txn) =>
            txn.provider === input.provider &&
            txn.providerTxnId === input.providerTxnId,
        );
        if (index >= 0) {
          // upsert by (provider, provider_txn_id): created → succeeded
          state.transactions[index] = input;
          return;
        }
      }
      state.transactions.push(input);
    },
    async recordWebhookEvent(input: WebhookEventInput) {
      const key = `${input.provider}:${input.eventId}`;
      const existing = state.webhookEvents.get(key);
      if (existing) {
        return { alreadyProcessed: existing.processed };
      }
      state.webhookEvents.set(key, { ...input, processed: false });
      return { alreadyProcessed: false };
    },
    async markWebhookProcessed(provider, eventId) {
      const key = `${provider}:${eventId}`;
      const existing = state.webhookEvents.get(key);
      if (existing) {
        existing.processed = true;
      }
    },
    async upsertUsageCounter(patch) {
      const key = counterKey(patch.organizationId, patch.metric, patch.periodMonth);
      const current = state.usageCounters.get(key) ?? {
        includedQuantity: 0,
        addonQuantity: 0,
        usedQuantity: 0,
      };
      state.usageCounters.set(key, {
        usedQuantity: current.usedQuantity,
        includedQuantity: patch.includedQuantity ?? current.includedQuantity,
        addonQuantity: current.addonQuantity + (patch.addonQuantityDelta ?? 0),
      });
    },
    async insertUsageAddon(input) {
      state.usageAddons.push({
        organizationId: input.organizationId,
        metric: input.metric,
        quantity: input.quantity,
      });
    },
    async upsertFeatureAddon(input) {
      state.featureAddons.set(`${input.organizationId}:${input.featureKey}`, {
        featureKey: input.featureKey,
        enabled: input.enabled,
      });
    },
  };

  return { repo, state };
}
