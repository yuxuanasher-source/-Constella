import { describe, expect, it } from "vitest";

import {
  extractStructuredSettlementRule,
  isStructuredSettlementRuleEmpty,
  validateStructuredSettlementRule,
} from "./structured-settlement-rule";

describe("validateStructuredSettlementRule", () => {
  it("accepts a well-formed structured rule", () => {
    const rule = validateStructuredSettlementRule({
      hourlyTiers: [
        { uptoMinutes: 120, ratePerHour: 60 },
        { uptoMinutes: null, ratePerHour: 90 },
      ],
      penalties: [
        {
          key: "red",
          trigger: "red_evidence",
          mode: "percent",
          value: 5000,
          label: "红证据扣半",
        },
      ],
      floorAmount: 100,
      capAmount: 2000,
    });

    expect(rule.schemaVersion).toBe(1);
    expect(rule.hourlyTiers).toHaveLength(2);
    expect(rule.penalties[0]).toMatchObject({
      trigger: "red_evidence",
      mode: "percent",
      value: 5000,
    });
    expect(rule.floorAmount).toBe(100);
    expect(rule.capAmount).toBe(2000);
  });

  it("rejects a floor above the cap", () => {
    expect(() =>
      validateStructuredSettlementRule({ floorAmount: 500, capAmount: 100 }),
    ).toThrow("保底金额不能高于封顶金额");
  });

  it("rejects more than one open-ended tier", () => {
    expect(() =>
      validateStructuredSettlementRule({
        hourlyTiers: [
          { uptoMinutes: null, ratePerHour: 60 },
          { uptoMinutes: null, ratePerHour: 90 },
        ],
      }),
    ).toThrow("只能有一个不封顶的最高档位");
  });

  it("rejects an invalid penalty trigger", () => {
    expect(() =>
      validateStructuredSettlementRule({
        penalties: [{ trigger: "nonsense", mode: "fixed", value: 10 }],
      }),
    ).toThrow("扣罚触发条件无效");
  });

  it("rejects a percent penalty above 100%", () => {
    expect(() =>
      validateStructuredSettlementRule({
        penalties: [{ trigger: "red_evidence", mode: "percent", value: 12000 }],
      }),
    ).toThrow("扣罚比例不能超过 100%");
  });
});

describe("extractStructuredSettlementRule", () => {
  it("drops malformed fields without throwing", () => {
    const parts = extractStructuredSettlementRule({
      hourlyTiers: [
        { uptoMinutes: 120, ratePerHour: 60 },
        { uptoMinutes: 60, ratePerHour: "oops" },
      ],
      penalties: "not-an-array",
      floorAmount: -5,
      capAmount: 800,
    });

    expect(parts.hourlyTiers).toEqual([{ uptoMinutes: 120, ratePerHour: 60 }]);
    expect(parts.penalties).toBeUndefined();
    expect(parts.floorAmount).toBeUndefined();
    expect(parts.capAmount).toBe(800);
  });

  it("returns empty parts for a non-object payload", () => {
    expect(extractStructuredSettlementRule(null)).toEqual({});
    expect(extractStructuredSettlementRule("x")).toEqual({});
    expect(
      isStructuredSettlementRuleEmpty(extractStructuredSettlementRule({})),
    ).toBe(true);
  });
});
