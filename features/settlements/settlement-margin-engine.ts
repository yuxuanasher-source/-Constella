export type SettlementLineDirection = "revenue" | "cost";

export type SettlementLineItem = {
  streamerId?: string | null;
  direction: SettlementLineDirection;
  amount: number;
};

export type CollaborationSplitMode = "percentage" | "hourly_fixed";

export type MarginSummary = {
  revenue: number;
  cost: number;
  grossMargin: number;
};

export function summarizeLineItems(
  items: SettlementLineItem[],
): MarginSummary {
  let revenue = 0;
  let cost = 0;
  for (const item of items) {
    if (item.direction === "revenue") {
      revenue += item.amount;
    } else {
      cost += item.amount;
    }
  }
  revenue = roundCurrency(revenue);
  cost = roundCurrency(cost);
  return { revenue, cost, grossMargin: roundCurrency(revenue - cost) };
}

export type CollaborationSplitInput = {
  mode: CollaborationSplitMode;
  sharePercentage?: number | null;
  hourlyFixedAmount?: number | null;
  grossMargin: number;
  totalHours: number;
};

export type CollaborationSplitResult = {
  basisAmount: number;
  computedAmount: number;
};

// 决策 4：百分比基数 = 项目毛利（不为负）；固定模式按结算时长(小时)。
export function calculateCollaborationSplit(
  input: CollaborationSplitInput,
): CollaborationSplitResult {
  if (input.mode === "percentage") {
    const basis = Math.max(0, input.grossMargin);
    const pct = input.sharePercentage ?? 0;
    return {
      basisAmount: roundCurrency(basis),
      computedAmount: roundCurrency(basis * pct),
    };
  }

  const hours = Math.max(0, input.totalHours);
  const rate = input.hourlyFixedAmount ?? 0;
  return {
    basisAmount: roundCurrency(hours),
    computedAmount: roundCurrency(hours * rate),
  };
}

export type StreamerMargin = {
  streamerId: string | null;
  revenue: number;
  cost: number;
  margin: number;
};

export type SettlementBreakdown = MarginSummary & {
  mcnSplit: number;
  netMargin: number;
  byStreamer: StreamerMargin[];
};

export function buildSettlementBreakdown({
  items,
  mcnSplit = 0,
}: {
  items: SettlementLineItem[];
  mcnSplit?: number;
}): SettlementBreakdown {
  const summary = summarizeLineItems(items);

  const byStreamerMap = new Map<string, { revenue: number; cost: number }>();
  for (const item of items) {
    const key = item.streamerId ?? "__project__";
    const entry = byStreamerMap.get(key) ?? { revenue: 0, cost: 0 };
    if (item.direction === "revenue") {
      entry.revenue += item.amount;
    } else {
      entry.cost += item.amount;
    }
    byStreamerMap.set(key, entry);
  }

  const byStreamer: StreamerMargin[] = Array.from(byStreamerMap.entries()).map(
    ([key, entry]) => {
      const revenue = roundCurrency(entry.revenue);
      const cost = roundCurrency(entry.cost);
      return {
        streamerId: key === "__project__" ? null : key,
        revenue,
        cost,
        margin: roundCurrency(revenue - cost),
      };
    },
  );

  const roundedSplit = roundCurrency(mcnSplit);
  return {
    ...summary,
    mcnSplit: roundedSplit,
    netMargin: roundCurrency(summary.grossMargin - roundedSplit),
    byStreamer,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
