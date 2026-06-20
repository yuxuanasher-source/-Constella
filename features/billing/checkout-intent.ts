import type {
  BillingCycle,
  BillingOrderKind,
  CheckoutIntent,
} from "./order-types";
import type { UsageMetric } from "./usage-metering";

const ORDER_KINDS: BillingOrderKind[] = [
  "subscription_new",
  "subscription_renewal",
  "subscription_upgrade",
  "subscription_downgrade",
  "usage_addon",
  "feature_addon",
];

const BILLING_CYCLES: BillingCycle[] = ["monthly", "annual"];

const USAGE_METRICS: UsageMetric[] = [
  "active_streamer",
  "seat",
  "ocr",
  "ai",
  "storage_mb",
  "export",
];

/**
 * 解析前端提交的下单意图。前端只能传意图（plan/cycle/metric/qty/feature），
 * 金额由服务端计算 —— 这里显式拒绝任何金额字段。
 */
export function parseCheckoutIntent(body: unknown): CheckoutIntent {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid checkout payload");
  }
  const record = body as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string" || !ORDER_KINDS.includes(kind as BillingOrderKind)) {
    throw new Error("Invalid order kind");
  }
  const rawTarget =
    record.target && typeof record.target === "object"
      ? (record.target as Record<string, unknown>)
      : {};

  if ("amount" in rawTarget || "amountCents" in rawTarget || "amount_cents" in rawTarget) {
    throw new Error("Amount cannot be supplied by the client");
  }

  const orderKind = kind as BillingOrderKind;
  const target: CheckoutIntent["target"] = {};

  if (typeof rawTarget.planCode === "string") {
    target.planCode = rawTarget.planCode;
  }
  if (
    typeof rawTarget.billingCycle === "string" &&
    BILLING_CYCLES.includes(rawTarget.billingCycle as BillingCycle)
  ) {
    target.billingCycle = rawTarget.billingCycle as BillingCycle;
  }
  if (
    typeof rawTarget.metric === "string" &&
    USAGE_METRICS.includes(rawTarget.metric as UsageMetric)
  ) {
    target.metric = rawTarget.metric as UsageMetric;
  }
  if (typeof rawTarget.quantity === "number" && Number.isFinite(rawTarget.quantity)) {
    target.quantity = rawTarget.quantity;
  }
  if (typeof rawTarget.featureKey === "string") {
    target.featureKey = rawTarget.featureKey;
  }

  return { kind: orderKind, target };
}
