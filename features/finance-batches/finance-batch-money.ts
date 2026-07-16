import type { FinanceAdjustmentDirection } from "./finance-batch-types";

export function financeAmount(value: number | string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    throw new Error("Invalid finance amount");
  }

  return Math.round(numeric * 100) / 100;
}

export function signedAdjustmentAmount(input: {
  direction: FinanceAdjustmentDirection;
  amount: number;
}): number {
  const amount = Math.abs(financeAmount(input.amount));
  return input.direction === "decrease" ? -amount : amount;
}

export function summarizeFinanceItems(
  items: Array<{ systemAmount: number; adjustmentAmount: number }>,
): {
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  itemCount: number;
} {
  const systemAmount = financeAmount(
    items.reduce((sum, item) => sum + item.systemAmount, 0),
  );
  const adjustmentAmount = financeAmount(
    items.reduce((sum, item) => sum + item.adjustmentAmount, 0),
  );

  return {
    systemAmount,
    adjustmentAmount,
    finalAmount: financeAmount(systemAmount + adjustmentAmount),
    itemCount: items.length,
  };
}
