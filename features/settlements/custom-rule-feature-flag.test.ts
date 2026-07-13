import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isCustomSettlementRuleExecutionEnabled,
  isCustomSettlementRulesEnabled,
} from "./custom-rule-feature-flag";

describe("isCustomSettlementRulesEnabled", () => {
  it("uses a direct static public env access for Next.js inlining", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "features/settlements/custom-rule-feature-flag.ts",
      ),
      "utf8",
    );

    expect(source).toMatch(
      /process\.env\.NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED/,
    );
  });

  it.each([undefined, "", "false", "TRUE", " true "])(
    "returns false for %j",
    (value) => {
      expect(
        isCustomSettlementRulesEnabled({
          NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED: value,
        }),
      ).toBe(false);
    },
  );

  it('returns true only for exact "true"', () => {
    expect(
      isCustomSettlementRulesEnabled({
        NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED: "true",
      }),
    ).toBe(true);
  });
});

describe("isCustomSettlementRuleExecutionEnabled", () => {
  it("uses a direct static server env access for runtime gating", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "features/settlements/custom-rule-feature-flag.ts",
      ),
      "utf8",
    );

    expect(source).toMatch(
      /process\.env\.CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED/,
    );
  });

  it.each([undefined, "", "false", "TRUE", " true ", "1"])(
    "returns false for %j",
    (value) => {
      expect(
        isCustomSettlementRuleExecutionEnabled({
          CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED: value,
        }),
      ).toBe(false);
    },
  );

  it('returns true only for exact "true"', () => {
    expect(
      isCustomSettlementRuleExecutionEnabled({
        CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED: "true",
      }),
    ).toBe(true);
  });
});
