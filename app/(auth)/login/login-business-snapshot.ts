export type PendingReportSnapshot = {
  label: "待审核报数";
  value: string;
  helper: string;
  isLive: boolean;
};

export type MonthlyGrossProfitSnapshot = {
  label: "本月毛利";
  value: string;
  trendLabel: string;
  isLive: boolean;
};

export type LoginBusinessSnapshot = {
  pendingReports: PendingReportSnapshot;
  monthlyGrossProfit: MonthlyGrossProfitSnapshot;
};

type SettlementBatchMetricRow = {
  batch_type: "receivable" | "payable";
  period_start: string;
  computed_amount: number | string | null;
  manual_amount: number | string | null;
  adjustment_amount: number | string | null;
};

export type LoginSnapshotClient = {
  from(table: "live_reports"): {
    select(
      columns: "id",
      options: { count: "exact"; head: true },
    ): {
      in(
        column: "status",
        values: Array<"pending_review" | "pending_adjudication">,
      ): PromiseLike<{ count: number | null; error: unknown }>;
    };
  };
  from(table: "settlement_batches"): {
    select(
      columns: "batch_type, period_start, computed_amount, manual_amount, adjustment_amount",
    ): {
      neq(column: "status", value: "voided"): {
        gte(column: "period_start", value: string): {
          lt(
            column: "period_start",
            value: string,
          ): PromiseLike<{
            data: SettlementBatchMetricRow[] | null;
            error: unknown;
          }>;
        };
      };
    };
  };
};

type BusinessSnapshotOptions = {
  now?: Date;
};

const pendingReportStatuses = ["pending_review", "pending_adjudication"] as const;

export async function getLoginBusinessSnapshot(
  client: LoginSnapshotClient | null,
  options: BusinessSnapshotOptions = {},
): Promise<LoginBusinessSnapshot> {
  const [pendingReports, monthlyGrossProfit] = await Promise.all([
    getPendingReportSnapshot(client),
    getMonthlyGrossProfitSnapshot(client, options.now ?? new Date()),
  ]);

  return {
    pendingReports,
    monthlyGrossProfit,
  };
}

export function formatPendingReportSnapshot(
  pendingReportCount: number | null,
): PendingReportSnapshot {
  if (pendingReportCount === null) {
    return {
      label: "待审核报数",
      value: "实时",
      helper: "同步中",
      isLive: false,
    };
  }

  return {
    label: "待审核报数",
    value: `${pendingReportCount} 笔`,
    helper: pendingReportCount > 0 ? "须处理" : "已清空",
    isLive: true,
  };
}

export function formatMonthlyGrossProfitSnapshot(input: {
  currentAmount: number | null;
  previousAmount: number | null;
}): MonthlyGrossProfitSnapshot {
  if (input.currentAmount === null || input.previousAmount === null) {
    return {
      label: "本月毛利",
      value: "实时",
      trendLabel: "同步中",
      isLive: false,
    };
  }

  return {
    label: "本月毛利",
    value: formatCurrency(input.currentAmount),
    trendLabel: formatTrend(input.currentAmount, input.previousAmount),
    isLive: true,
  };
}

async function getPendingReportSnapshot(
  client: LoginSnapshotClient | null,
): Promise<PendingReportSnapshot> {
  if (!client) {
    return formatPendingReportSnapshot(null);
  }

  try {
    const { count, error } = await client
      .from("live_reports")
      .select("id", { count: "exact", head: true })
      .in("status", [...pendingReportStatuses]);

    if (error) {
      return formatPendingReportSnapshot(null);
    }

    return formatPendingReportSnapshot(count);
  } catch {
    return formatPendingReportSnapshot(null);
  }
}

async function getMonthlyGrossProfitSnapshot(
  client: LoginSnapshotClient | null,
  now: Date,
): Promise<MonthlyGrossProfitSnapshot> {
  if (!client) {
    return formatMonthlyGrossProfitSnapshot({
      currentAmount: null,
      previousAmount: null,
    });
  }

  const range = getMonthRange(now);

  try {
    const { data, error } = await client
      .from("settlement_batches")
      .select(
        "batch_type, period_start, computed_amount, manual_amount, adjustment_amount",
      )
      .neq("status", "voided")
      .gte("period_start", range.previousMonthStart)
      .lt("period_start", range.nextMonthStart);

    if (error) {
      return formatMonthlyGrossProfitSnapshot({
        currentAmount: null,
        previousAmount: null,
      });
    }

    return formatMonthlyGrossProfitSnapshot(
      calculateMonthlyGrossProfit(data ?? [], range),
    );
  } catch {
    return formatMonthlyGrossProfitSnapshot({
      currentAmount: null,
      previousAmount: null,
    });
  }
}

function calculateMonthlyGrossProfit(
  rows: SettlementBatchMetricRow[],
  range: ReturnType<typeof getMonthRange>,
) {
  let currentAmount = 0;
  let previousAmount = 0;

  for (const row of rows) {
    const amount =
      toAmount(row.computed_amount) +
      toAmount(row.manual_amount) +
      toAmount(row.adjustment_amount);
    const signedAmount = row.batch_type === "payable" ? -amount : amount;

    if (
      row.period_start >= range.currentMonthStart &&
      row.period_start < range.nextMonthStart
    ) {
      currentAmount += signedAmount;
    } else if (
      row.period_start >= range.previousMonthStart &&
      row.period_start < range.currentMonthStart
    ) {
      previousAmount += signedAmount;
    }
  }

  return { currentAmount, previousAmount };
}

function getMonthRange(now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return {
    previousMonthStart: formatUtcDate(new Date(Date.UTC(year, month - 1, 1))),
    currentMonthStart: formatUtcDate(new Date(Date.UTC(year, month, 1))),
    nextMonthStart: formatUtcDate(new Date(Date.UTC(year, month + 1, 1))),
  };
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toAmount(value: number | string | null): number {
  if (value === null) {
    return 0;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTrend(currentAmount: number, previousAmount: number) {
  if (currentAmount === 0) {
    return "持平";
  }

  if (previousAmount === 0) {
    return "新增";
  }

  const pct = ((currentAmount - previousAmount) / Math.abs(previousAmount)) * 100;
  const rounded = Math.abs(pct).toFixed(1);
  if (pct > 0) {
    return `↑${rounded}%`;
  }
  if (pct < 0) {
    return `↓${rounded}%`;
  }
  return "持平";
}
