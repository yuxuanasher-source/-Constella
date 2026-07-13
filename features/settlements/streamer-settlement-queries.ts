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
  explanation?: StreamerPayableExplanation;
};

export type StreamerPayableExplanation = {
  finalAmount: number;
  finalAmountCents: number;
  components: Array<{
    key: string;
    label: string;
    amount: number;
    amountCents: number;
  }>;
  evidenceFacts: {
    hours: number;
    evidenceLevel: "green" | "yellow" | "red" | "unknown";
    timeSource: string;
    sourceReportCount: number;
  };
  explanationZh: string;
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
  const roundedHours = Math.round((hours / 60) * 10) / 10;
  const amount = Number(row.payable_amount);

  return {
    id: row.id,
    projectName: row.project_name,
    month: monthKey(row.period_start),
    amount,
    computedAmount: Number(row.computed_amount),
    manualAmount: Number(row.manual_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    hours: roundedHours,
    evidence: `${row.evidence_level ?? "unknown"} · ${timeSource || source}`,
    source,
    createdAt: row.created_at,
    explanation: toStreamerPayableExplanation(row, {
      hours: roundedHours,
      timeSource: timeSource || source,
      amount,
    }),
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

function toStreamerPayableExplanation(
  row: StreamerPayableSafeRow,
  facts: { hours: number; timeSource: string; amount: number },
): StreamerPayableExplanation | undefined {
  const ruleEngine = recordValue(row.evidence_snapshot.ruleEngine);
  if (!ruleEngine) {
    return undefined;
  }

  const finalAmountCents = Math.round(facts.amount * 100);
  const components = toPersonalComponents(ruleEngine);
  const evidenceFacts = {
    hours: facts.hours,
    evidenceLevel: row.evidence_level ?? "unknown",
    timeSource: facts.timeSource,
    sourceReportCount: stringArrayValue(ruleEngine.sourceReportIds).length,
  };

  return {
    finalAmount: facts.amount,
    finalAmountCents,
    components,
    evidenceFacts,
    explanationZh: buildPersonalExplanationZh({
      projectName: row.project_name,
      finalAmountCents,
      components,
      evidenceFacts,
    }),
  };
}

function toPersonalComponents(
  ruleEngine: Record<string, unknown>,
): StreamerPayableExplanation["components"] {
  const outputs =
    recordValue(ruleEngine.personalComponentsCents) ??
    recordValue(ruleEngine.componentOutputsCents) ??
    recordValue(ruleEngine.namedOutputsCents);
  if (!outputs) {
    return [];
  }

  return Object.entries(outputs)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .filter(([key]) => isStreamerSafeComponentKey(key))
    .map(([key, amountCents]) => ({
      key,
      label: settlementComponentLabel(key),
      amount: amountCents / 100,
      amountCents,
    }));
}

function isStreamerSafeComponentKey(key: string): boolean {
  return !/(formula|ast|receivable|margin|tax|cost|other|roster|reviewer|threshold|risk|profit|gross|internal|external)/i.test(
    key,
  );
}

function buildPersonalExplanationZh(input: {
  projectName: string;
  finalAmountCents: number;
  components: StreamerPayableExplanation["components"];
  evidenceFacts: StreamerPayableExplanation["evidenceFacts"];
}): string {
  const componentText = input.components.length
    ? input.components
        .map((component) => `${component.label} ${formatYuan(component.amountCents)}`)
        .join("、")
    : "个人结算项";
  const hoursText = input.evidenceFacts.hours.toFixed(1);
  return `本次 ${input.projectName} 结算包含${componentText}，最终应付 ${formatYuan(input.finalAmountCents)}；有效时长 ${hoursText} 小时，时间来源 ${input.evidenceFacts.timeSource}。`;
}

function settlementComponentLabel(key: string): string {
  const labels: Record<string, string> = {
    base: "底薪",
    baseSalary: "底薪",
    cpt: "有效时长",
    cptPay: "有效时长",
    timePay: "有效时长",
    cps: "CPS",
    cpa: "CPA",
    bonus: "奖励",
    adjustment: "调整",
    deduction: "扣减",
    gift: "礼物",
    manual: "人工承载",
    final: "最终金额",
  };
  return labels[key] ?? key;
}

function formatYuan(amountCents: number): string {
  const yuan = amountCents / 100;
  return `¥${yuan.toLocaleString("zh-CN", {
    minimumFractionDigits: yuan % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
