import { describe, expect, it } from "vitest";

import { toCents, toYuan } from "./hourly-rate-units";

describe("project hourly-rate units", () => {
  it("treats the database rate as yuan per hour and converts yuan to cents", () => {
    expect(toYuan(80)).toBe(80);
    expect(toCents(80)).toBe(8_000);
  });

  it("safely normalizes absent and non-finite rates", () => {
    expect(toYuan(null)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
