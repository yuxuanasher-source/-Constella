import type { BillingRepo } from "./billing-repo";
import type {
  PaymentProvider,
  StatementEntry,
} from "./providers/payment-provider";

export type ReconcileDetail = {
  ourOnly: string[];
  channelOnly: string[];
  amountMismatch: Array<{
    providerTxnId: string;
    ours: number;
    channel: number;
  }>;
};

export type ReconcileResult = {
  status: "balanced" | "mismatch";
  matchedCount: number;
  mismatchedCount: number;
  expectedAmountCents: number;
  providerAmountCents: number;
  detail: ReconcileDetail;
};

/**
 * 单号级对账（纯函数）：比较我方成功支付流水与渠道对账文件。
 * 任一侧缺单或金额不一致即 mismatch。
 */
export function reconcile({
  ours,
  channel,
}: {
  ours: StatementEntry[];
  channel: StatementEntry[];
}): ReconcileResult {
  const ourMap = indexByTxn(ours);
  const channelMap = indexByTxn(channel);

  let matchedCount = 0;
  const ourOnly: string[] = [];
  const channelOnly: string[] = [];
  const amountMismatch: ReconcileDetail["amountMismatch"] = [];

  for (const [txnId, amount] of ourMap) {
    const channelAmount = channelMap.get(txnId);
    if (channelAmount === undefined) {
      ourOnly.push(txnId);
    } else if (channelAmount !== amount) {
      amountMismatch.push({ providerTxnId: txnId, ours: amount, channel: channelAmount });
    } else {
      matchedCount += 1;
    }
  }
  for (const txnId of channelMap.keys()) {
    if (!ourMap.has(txnId)) {
      channelOnly.push(txnId);
    }
  }

  const mismatchedCount =
    ourOnly.length + channelOnly.length + amountMismatch.length;

  return {
    status: mismatchedCount === 0 ? "balanced" : "mismatch",
    matchedCount,
    mismatchedCount,
    expectedAmountCents: sum(ours),
    providerAmountCents: sum(channel),
    detail: { ourOnly, channelOnly, amountMismatch },
  };
}

export type ReconciliationAlert = (
  result: ReconcileResult & { reconDate: string; provider: string },
) => Promise<void>;

/**
 * 日终对账编排：聚合我方当日成功流水 + 拉渠道对账文件 → diff → 落
 * billing_reconciliations；mismatch 时告警。
 */
export async function runReconciliation({
  repo,
  provider,
  date,
  alert,
}: {
  repo: BillingRepo;
  provider: PaymentProvider;
  date: string;
  alert?: ReconciliationAlert;
}): Promise<ReconcileResult> {
  const ours = await repo.listSucceededPaymentsByDate(provider.name, date);
  const channel = await provider.fetchStatement(date);
  const result = reconcile({ ours, channel });

  await repo.upsertReconciliation({
    reconDate: date,
    provider: provider.name,
    expectedAmountCents: result.expectedAmountCents,
    providerAmountCents: result.providerAmountCents,
    matchedCount: result.matchedCount,
    mismatchedCount: result.mismatchedCount,
    status: result.status,
    detail: result.detail,
  });

  if (result.status === "mismatch" && alert) {
    await alert({ ...result, reconDate: date, provider: provider.name });
  }

  return result;
}

function indexByTxn(entries: StatementEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.providerTxnId, (map.get(entry.providerTxnId) ?? 0) + entry.amountCents);
  }
  return map;
}

function sum(entries: StatementEntry[]): number {
  return entries.reduce((total, entry) => total + entry.amountCents, 0);
}
