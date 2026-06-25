import type { BillingCycle } from "./order-types";

/** 把日期归一为 UTC 的 `YYYY-MM-DD`。 */
export function toDateString(value: string | Date): string {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 在 `YYYY-MM-DD` 上推进一个计费周期（月 +1 月 / 年 +1 年）。 */
export function advancePeriod(start: string | Date, cycle: BillingCycle): string {
  const date = new Date(start);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const next =
    cycle === "annual"
      ? new Date(Date.UTC(year + 1, month, day))
      : new Date(Date.UTC(year, month + 1, day));
  return toDateString(next);
}

/** 当前用量账期（每月 1 号）。 */
export function periodMonthOf(value: string | Date): string {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}-01`;
}
