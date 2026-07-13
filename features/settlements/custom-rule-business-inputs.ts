import { assertSafeIntegerValue, type TypedRuntimeValue } from "./custom-rule-types";

export type CustomRuleBusinessInputReport = Readonly<{
  liveReportId: string;
  streamerId: string;
  periodStart: string;
  periodEnd: string;
}>;

export type CustomRuleBusinessInputRow = Readonly<{
  salesAmountCents?: number;
  ordersCount?: number;
  giftAmountCents?: number;
  liveReportId?: string;
  streamerId?: string;
  periodStart?: string;
  periodEnd?: string;
  importBatchId: string;
  rowIndex: number;
}>;

export type CustomRuleBusinessInputError = Readonly<{
  code:
    | "EXPLICIT_REPORT_ID_REQUIRED"
    | "UNKNOWN_LIVE_REPORT"
    | "INCOMPATIBLE_PERIOD"
    | "NON_ADDITIVE_CONFLICT"
    | "UNSAFE_INTEGER";
  liveReportId?: string;
  importBatchId: string;
  rowIndex: number;
}>;

export type CustomRuleBusinessInputAdaptResult = Readonly<{
  variablesByReportId: Record<string, Record<string, TypedRuntimeValue>>;
  errors: CustomRuleBusinessInputError[];
  executionSnapshot: {
    sources: Array<{
      importBatchId: string;
      rowIndex: number;
      liveReportId: string;
      streamerId: string;
      periodStart: string;
      periodEnd: string;
    }>;
  };
}>;

type DocumentedBusinessInputRow = Readonly<{
  salesAmountCents?: number;
  ordersCount?: number;
  giftAmountCents?: number;
  liveReportId: string;
  streamerId: string;
  periodStart: string;
  periodEnd: string;
  importBatchId: string;
  rowIndex: number;
}>;

export function adaptCustomRuleBusinessInputs(input: {
  reports: readonly CustomRuleBusinessInputReport[];
  rows: readonly CustomRuleBusinessInputRow[];
}): CustomRuleBusinessInputAdaptResult {
  const reportsById = new Map(
    input.reports.map((report) => [report.liveReportId, report]),
  );
  const sortedRows = [...input.rows].sort(
    (left, right) =>
      left.importBatchId.localeCompare(right.importBatchId) ||
      left.rowIndex - right.rowIndex,
  );
  const errors: CustomRuleBusinessInputError[] = [];
  const totals = new Map<
    string,
    {
      salesAmountCents?: number;
      ordersCount?: number;
      giftAmountCents?: number;
    }
  >();
  const reportStreamer = new Map<string, string>();
  const conflicted = new Set<string>();
  const sources: CustomRuleBusinessInputAdaptResult["executionSnapshot"]["sources"] =
    [];

  for (const sourceRow of sortedRows) {
    const row = documentedRow(sourceRow);
    if (!row.liveReportId) {
      errors.push(error("EXPLICIT_REPORT_ID_REQUIRED", row));
      continue;
    }
    const report = reportsById.get(row.liveReportId);
    if (!report) {
      errors.push(error("UNKNOWN_LIVE_REPORT", row, row.liveReportId));
      continue;
    }
    if (
      row.periodStart !== report.periodStart ||
      row.periodEnd !== report.periodEnd
    ) {
      errors.push(error("INCOMPATIBLE_PERIOD", row, row.liveReportId));
      continue;
    }
    if (row.streamerId !== report.streamerId) {
      errors.push(error("NON_ADDITIVE_CONFLICT", row, row.liveReportId));
      conflicted.add(row.liveReportId);
      continue;
    }
    const seenStreamer = reportStreamer.get(row.liveReportId);
    if (seenStreamer && seenStreamer !== row.streamerId) {
      errors.push(error("NON_ADDITIVE_CONFLICT", row, row.liveReportId));
      conflicted.add(row.liveReportId);
      continue;
    }
    reportStreamer.set(row.liveReportId, row.streamerId);
    const aggregate =
      totals.get(row.liveReportId) ??
      {};
    try {
      if (row.salesAmountCents !== undefined) {
        aggregate.salesAmountCents = addSafe(
          aggregate.salesAmountCents,
          row.salesAmountCents,
          "salesAmountCents",
        );
      }
      if (row.ordersCount !== undefined) {
        aggregate.ordersCount = addSafe(
          aggregate.ordersCount,
          row.ordersCount,
          "ordersCount",
        );
      }
      if (row.giftAmountCents !== undefined) {
        aggregate.giftAmountCents = addSafe(
          aggregate.giftAmountCents,
          row.giftAmountCents,
          "giftAmountCents",
        );
      }
    } catch {
      errors.push(error("UNSAFE_INTEGER", row, row.liveReportId));
      conflicted.add(row.liveReportId);
      continue;
    }
    totals.set(row.liveReportId, aggregate);
    sources.push({
      importBatchId: row.importBatchId,
      rowIndex: row.rowIndex,
      liveReportId: row.liveReportId,
      streamerId: row.streamerId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    });
  }

  const variablesByReportId: Record<string, Record<string, TypedRuntimeValue>> =
    {};
  for (const [liveReportId, aggregate] of [...totals.entries()].sort()) {
    if (conflicted.has(liveReportId)) continue;
    const variables: Record<string, TypedRuntimeValue> = {};
    if (aggregate.salesAmountCents !== undefined) {
      variables.sales_amount = {
        type: "money_cents",
        amountCents: aggregate.salesAmountCents,
      };
    }
    if (aggregate.ordersCount !== undefined) {
      variables.orders_count = {
        type: "integer",
        value: aggregate.ordersCount,
      };
    }
    if (aggregate.giftAmountCents !== undefined) {
      variables.gift_amount = {
        type: "money_cents",
        amountCents: aggregate.giftAmountCents,
      };
    }
    variablesByReportId[liveReportId] = variables;
  }

  return {
    variablesByReportId,
    errors,
    executionSnapshot: { sources },
  };
}

function documentedRow(row: CustomRuleBusinessInputRow): DocumentedBusinessInputRow {
  return {
    ...(row.salesAmountCents === undefined
      ? {}
      : { salesAmountCents: row.salesAmountCents }),
    ...(row.ordersCount === undefined ? {} : { ordersCount: row.ordersCount }),
    ...(row.giftAmountCents === undefined
      ? {}
      : { giftAmountCents: row.giftAmountCents }),
    liveReportId: row.liveReportId ?? "",
    streamerId: row.streamerId ?? "",
    periodStart: row.periodStart ?? "",
    periodEnd: row.periodEnd ?? "",
    importBatchId: row.importBatchId,
    rowIndex: row.rowIndex,
  };
}

function addSafe(
  total: number | undefined,
  value: number,
  label: string,
): number {
  assertSafeIntegerValue(value, label);
  const next = (total ?? 0) + value;
  return assertSafeIntegerValue(next, label);
}

function error(
  code: CustomRuleBusinessInputError["code"],
  row: DocumentedBusinessInputRow,
  liveReportId?: string,
): CustomRuleBusinessInputError {
  return {
    code,
    ...(liveReportId ? { liveReportId } : {}),
    importBatchId: row.importBatchId,
    rowIndex: row.rowIndex,
  };
}
