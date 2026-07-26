/**
 * Project hourly rates are stored and entered as yuan per hour.
 */
export function toYuan(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0;
}

export function toCents(value: number | null | undefined): number {
  return Math.round(toYuan(value) * 100);
}
