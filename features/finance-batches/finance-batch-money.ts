import type { FinanceAdjustmentDirection } from "./finance-batch-types";

export function financeAmount(value: number | string): number {
  return centsToAmount(financeAmountCents(value));
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

function financeAmountCents(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid finance amount");
    }

    return parseDecimalStringToCents(numberToDecimalString(value));
  }

  return parseDecimalStringToCents(value);
}

function numberToDecimalString(value: number): string {
  if (!String(value).includes("e")) {
    return String(value);
  }

  return value.toFixed(12).replace(/\.?0+$/, "");
}

function parseDecimalStringToCents(value: string): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Invalid finance amount");
  }

  const sign = value.startsWith("-") ? -1 : 1;
  const unsignedValue = sign === -1 ? value.slice(1) : value;
  const [yuanPart, fractionPart = ""] = unsignedValue.split(".");
  const yuanCents = Number.parseInt(yuanPart, 10) * 100;
  const paddedFraction = fractionPart.padEnd(3, "0");
  const baseCents = Number.parseInt(paddedFraction.slice(0, 2), 10);
  const roundUpCents =
    Number.parseInt(paddedFraction[2] ?? "0", 10) >= 5 ? 1 : 0;

  return sign * (yuanCents + baseCents + roundUpCents);
}

function centsToAmount(cents: number): number {
  return cents / 100;
}
