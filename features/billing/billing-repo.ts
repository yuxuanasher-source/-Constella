import type { BillingPlanTier, SubscriptionStatus } from "./billing-gates";
import type {
  BillingCycle,
  BillingOrderKind,
  BillingOrderStatus,
  BillingTransactionStatus,
  BillingTransactionType,
  OrderTarget,
} from "./order-types";
import type { PlanPriceRow } from "./pricing";
import type { UsageMetric } from "./usage-metering";

export type PlanRecord = {
  id: string;
  code: string;
  tier: BillingPlanTier;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedActiveStreamers: number;
  includedSeats: number;
  includedOcr: number;
  includedAi: number;
  includedStorageMb: number;
  includedExports: number;
};

export type SubscriptionRecord = {
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string | null;
  graceUntil?: string | null;
  pendingPlanId?: string | null;
  pendingBillingCycle?: BillingCycle | null;
  autoRenew: boolean;
  lastOrderId?: string | null;
};

export type OrderRecord = {
  id: string;
  organizationId: string;
  kind: BillingOrderKind;
  status: BillingOrderStatus;
  amountCents: number;
  currency: string;
  target: OrderTarget;
  planId?: string | null;
  planPriceId?: string | null;
  billingCycle?: BillingCycle | null;
  idempotencyKey: string;
  provider?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  createdBy: string;
};

export type NewOrderInput = Omit<OrderRecord, "id" | "status"> & {
  id?: string;
  status?: BillingOrderStatus;
};

export type TransactionInput = {
  id?: string;
  organizationId: string;
  orderId: string;
  type: BillingTransactionType;
  status: BillingTransactionStatus;
  amountCents: number;
  provider: string;
  providerTxnId?: string | null;
  providerPayload?: Record<string, unknown>;
  failureReason?: string | null;
  succeededAt?: string | null;
};

export type WebhookEventInput = {
  provider: string;
  eventId: string;
  signatureVerified: boolean;
  rawPayload: unknown;
  orderId?: string | null;
};

export type UsageCounterPatch = {
  organizationId: string;
  metric: UsageMetric;
  periodMonth: string;
  includedQuantity?: number;
  addonQuantityDelta?: number;
};

export type UsageAddonInput = {
  organizationId: string;
  metric: UsageMetric;
  quantity: number;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
};

export type FeatureAddonInput = {
  organizationId: string;
  featureKey: string;
  amountCents: number;
  enabled: boolean;
  periodStart: string;
  periodEnd: string;
};

/**
 * 计费数据访问层。把订单编排 / 状态机推进与 Supabase 查询解耦，
 * 便于用内存实现做幂等、状态机、并发回调的单元测试。
 */
export interface BillingRepo {
  getPlanByCode(code: string): Promise<PlanRecord | null>;
  getPlanById(id: string): Promise<PlanRecord | null>;
  getPlanPrices(planId: string): Promise<PlanPriceRow[]>;
  getPlanPriceId(planId: string, cycle: BillingCycle): Promise<string | null>;

  getSubscription(organizationId: string): Promise<SubscriptionRecord | null>;
  updateSubscription(
    organizationId: string,
    patch: Partial<SubscriptionRecord>,
  ): Promise<void>;

  findOrderByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<OrderRecord | null>;
  getOrderById(orderId: string): Promise<OrderRecord | null>;
  insertOrder(input: NewOrderInput): Promise<OrderRecord>;
  updateOrder(
    orderId: string,
    patch: Partial<OrderRecord>,
  ): Promise<void>;
  /**
   * 原子地把订单从 `pending` 翻成 `paid`。`transitioned=false` 表示
   * 订单不在 `pending`（已处理 / 已关闭），并发回调据此只生效一次。
   */
  markOrderPaid(
    orderId: string,
    paidAt: string,
  ): Promise<{ transitioned: boolean }>;

  /**
   * 记录一次资金动作。同一 (provider, provider_txn_id) 的支付按渠道单号
   * upsert（created → succeeded 转移），与 unique(provider, provider_txn_id)
   * 约束一致；退款用不同渠道单号则新增一行。
   */
  insertTransaction(input: TransactionInput): Promise<void>;

  /** 落库回调事件，返回该事件是否之前已成功处理（幂等基石）。 */
  recordWebhookEvent(
    input: WebhookEventInput,
  ): Promise<{ alreadyProcessed: boolean }>;
  markWebhookProcessed(provider: string, eventId: string): Promise<void>;

  upsertUsageCounter(patch: UsageCounterPatch): Promise<void>;
  insertUsageAddon(input: UsageAddonInput): Promise<void>;
  upsertFeatureAddon(input: FeatureAddonInput): Promise<void>;
}

const METRIC_INCLUDED_FIELD: Record<UsageMetric, keyof PlanRecord> = {
  active_streamer: "includedActiveStreamers",
  seat: "includedSeats",
  ocr: "includedOcr",
  ai: "includedAi",
  storage_mb: "includedStorageMb",
  export: "includedExports",
};

/** 套餐各指标的内置额度（用于订阅生效时重算 usage_monthly_counters）。 */
export function planIncludedQuantities(
  plan: PlanRecord,
): Record<UsageMetric, number> {
  const result = {} as Record<UsageMetric, number>;
  for (const metric of Object.keys(METRIC_INCLUDED_FIELD) as UsageMetric[]) {
    const value = plan[METRIC_INCLUDED_FIELD[metric]];
    result[metric] = typeof value === "number" ? value : 0;
  }
  return result;
}
