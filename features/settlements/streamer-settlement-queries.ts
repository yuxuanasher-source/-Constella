import type { SupabaseClient } from "@supabase/supabase-js";

export type StreamerPayableSafeRow = {
  id: string;
  project_name: string;
  period_start: string;
  period_end: string;
  computed_amount: number;
  manual_amount: number;
  adjustment_amount: number;
  payable_amount: number;
  evidence_level: "green" | "yellow" | "red" | null;
  evidence_snapshot: Record<string, unknown>;
  created_at: string;
};

export type StreamerPayableItem = {
  id: string;
  projectName: string;
  month: string;
  amount: number;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  hours: number;
  evidence: string;
  source: string;
  createdAt: string;
};

export type StreamerEarningsSummary = {
  currentMonth: {
    month: string;
    earned: number;
    pending: number;
    finalized: boolean;
    hours: number;
  };
  history: Array<{ month: string; earned: number }>;
  items: StreamerPayableItem[];
};

export async function listStreamerPayableItems(
  client: SupabaseClient,
  streamerId: string,
): Promise<StreamerPayableItem[]> {
  const { data, error } = await client
    .from("streamer_payable_items_safe")
    .select(
      "id, project_name, period_start, period_end, computed_amount, manual_amount, adjustment_amount, payable_amount, evidence_level, evidence_snapshot, created_at",
    )
    .eq("streamer_id", streamerId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<StreamerPayableSafeRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toStreamerPayableItem);
}

export function toStreamerPayableItem(
  row: StreamerPayableSafeRow,
): StreamerPayableItem {
  const hours = numberFromSnapshot(row.evidence_snapshot, "settlementDuration");
  const source =
    stringFromSnapshot(row.evidence_snapshot, "source") ||
    (hours > 0 ? "live_report" : "manual");
  const timeSource = stringFromSnapshot(row.evidence_snapshot, "timeSource");

  return {
    id: row.id,
    projectName: row.project_name,
    month: monthKey(row.period_start),
    amount: Number(row.payable_amount),
    computedAmount: Number(row.computed_amount),
    manualAmount: Number(row.manual_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    hours: Math.round((hours / 60) * 10) / 10,
    evidence: `${row.evidence_level ?? "unknown"} · ${timeSource || source}`,
    source,
    createdAt: row.created_at,
  };
}

export function toStreamerEarningsSummary(
  rows: StreamerPayableSafeRow[] | StreamerPayableItem[],
  options: { currentMonth?: string } = {},
): StreamerEarningsSummary {
  const items = rows.map((row) =>
    "projectName" in row ? row : toStreamerPayableItem(row),
  );
  const currentMonth =
    options.currentMonth ?? items[0]?.month ?? monthKey(new Date());
  const currentItems = items.filter((item) => item.month === currentMonth);
  const historyByMonth = new Map<string, number>();
  for (const item of items) {
    historyByMonth.set(
      item.month,
      (historyByMonth.get(item.month) ?? 0) + item.amount,
    );
  }

  return {
    currentMonth: {
      month: currentMonth,
      earned: sum(currentItems.map((item) => item.amount)),
      pending: 0,
      finalized: false,
      hours: sum(currentItems.map((item) => item.hours)),
    },
    history: Array.from(historyByMonth.entries())
      .map(([month, earned]) => ({ month, earned }))
      .sort((left, right) => right.month.localeCompare(left.month)),
    items,
  };
}

export function monthKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value.slice(0, 7) : "";
  }

  return date.toISOString().slice(0, 7);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function numberFromSnapshot(
  snapshot: Record<string, unknown>,
  key: string,
): number {
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFromSnapshot(
  snapshot: Record<string, unknown>,
  key: string,
): string {
  const value = snapshot[key];
  return typeof value === "string" ? value : "";
}
