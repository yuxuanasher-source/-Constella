import { describe, expect, it } from "vitest";

import {
  DEFAULT_ABNORMAL_TOTAL_INCREASE_BPS,
  DEFAULT_CUSTOM_RULE_SAFETY_CAP_CENTS,
  analyzeCustomRuleMaterialRisk,
} from "./custom-rule-risk";
import type { CustomRuleMaterialRiskInput } from "./custom-rule-risk";
import { MATERIAL_RISK_CODES } from "./custom-rule-types";

function safeInput(): CustomRuleMaterialRiskInput {
  return {
    simulation: {
      totalOldCents: "100000",
      totalNewCents: "110000",
      marginImpactCents: "-10000",
      riskFlags: [] as Array<{ code: string }>,
      scenarios: [{ amountCents: "50000" }],
      missingDataImpact: {
        policyAction: "route_item_to_review" as const,
        amountDeltaCents: null,
      },
    },
    currentMarginCents: "100000",
    contract: {
      target: { targetType: "project" as const, targetId: null },
      compositionMode: "add" as const,
      missingDataPolicy: { action: "route_item_to_review" as const },
      groupConflict: {
        resolution: "none" as const,
        conflictingGroupIds: [] as readonly string[],
      },
    },
  };
}

describe("custom rule material-risk analysis", () => {
  it("keeps the exported risk-code policy frozen and analyzer ordering stable", () => {
    expect(Object.isFrozen(MATERIAL_RISK_CODES)).toBe(true);
    expect(() =>
      (MATERIAL_RISK_CODES as unknown as string[]).reverse(),
    ).toThrow();

    const input = safeInput();
    const summary = analyzeCustomRuleMaterialRisk({
      ...input,
      simulation: {
        ...input.simulation,
        totalNewCents: "125000",
        scenarios: [{ amountCents: "100001" }],
      },
    });

    expect(summary.codes).toEqual([
      "abnormal_total_increase",
      "safety_cap_exceeded",
    ]);
  });

  it("returns documented conservative server defaults when configuration is absent", () => {
    const summary = analyzeCustomRuleMaterialRisk(safeInput());

    expect(DEFAULT_ABNORMAL_TOTAL_INCREASE_BPS).toBe(2_000);
    expect(DEFAULT_CUSTOM_RULE_SAFETY_CAP_CENTS).toBe("100000");
    expect(summary).toMatchObject({
      material: false,
      codes: [],
      configuration: {
        abnormalTotalIncreaseBps: {
          value: 2_000,
          source: "server_default",
        },
        safetyCapCents: {
          value: "100000",
          source: "server_default",
        },
      },
    });
  });

  it("detects every material risk code from simulation and contract facts", () => {
    const spoofedInput = {
      ...safeInput(),
      simulation: {
        totalOldCents: "100000",
        totalNewCents: "125000",
        marginImpactCents: "-100001",
        riskFlags: [{ code: "CUSTOM_RULE_RED_EVIDENCE_PRICED" }],
        scenarios: [{ amountCents: "100001" }],
        missingDataImpact: {
          policyAction: "use_explicit_default",
          amountDeltaCents: "1",
        },
      },
      currentMarginCents: "100000",
      contract: {
        target: { targetType: "streamer_group", targetId: "group-a" },
        compositionMode: "replace",
        missingDataPolicy: {
          action: "use_explicit_default",
          defaultValue: { type: "money_cents", amountCents: 0 },
        },
        groupConflict: {
          resolution: "explicit_exception",
          conflictingGroupIds: ["group-conflict-a"],
        },
      },
      explicitDefaultChangesMoney: false,
      overlappingGroupException: false,
    } as const;
    const summary = analyzeCustomRuleMaterialRisk(spoofedInput);

    expect(summary.material).toBe(true);
    expect(summary.codes).toEqual(MATERIAL_RISK_CODES);
    expect(summary.findings.map((finding) => finding.code)).toEqual(
      MATERIAL_RISK_CODES,
    );
  });

  it("uses organization thresholds and returns their exact source", () => {
    const input = safeInput();

    const summary = analyzeCustomRuleMaterialRisk({
      ...input,
      simulation: {
        ...input.simulation,
        totalNewCents: "140000",
        scenarios: [{ amountCents: "200000" }],
      },
      configuration: {
        organization: {
          abnormalTotalIncreaseBps: 5_000,
          safetyCapCents: "500000",
        },
      },
    });

    expect(summary.material).toBe(false);
    expect(summary.configuration).toEqual({
      abnormalTotalIncreaseBps: { value: 5_000, source: "organization" },
      safetyCapCents: { value: "500000", source: "organization" },
    });
  });

  it("lets each project threshold override its organization counterpart independently", () => {
    const input = safeInput();

    const summary = analyzeCustomRuleMaterialRisk({
      ...input,
      simulation: {
        ...input.simulation,
        totalNewCents: "130000",
        scenarios: [{ amountCents: "200001" }],
      },
      configuration: {
        organization: {
          abnormalTotalIncreaseBps: 5_000,
          safetyCapCents: "200000",
        },
        project: {
          abnormalTotalIncreaseBps: 2_500,
        },
      },
    });

    expect(summary.codes).toEqual([
      "abnormal_total_increase",
      "safety_cap_exceeded",
    ]);
    expect(summary.configuration).toEqual({
      abnormalTotalIncreaseBps: { value: 2_500, source: "project" },
      safetyCapCents: { value: "200000", source: "organization" },
    });
  });

  it("treats a positive total over a zero baseline as abnormal", () => {
    const input = safeInput();

    expect(
      analyzeCustomRuleMaterialRisk({
        ...input,
        simulation: {
          ...input.simulation,
          totalOldCents: "0",
          totalNewCents: "1",
        },
      }).codes,
    ).toContain("abnormal_total_increase");
  });

  it("does not flag threshold equality or inert explicit defaults", () => {
    const input = safeInput();

    expect(
      analyzeCustomRuleMaterialRisk({
        ...input,
        simulation: {
          ...input.simulation,
          totalNewCents: "120000",
          scenarios: [{ amountCents: "100000" }],
          missingDataImpact: {
            policyAction: "use_explicit_default",
            amountDeltaCents: "0",
          },
        },
        contract: {
          ...input.contract,
          missingDataPolicy: {
            action: "use_explicit_default",
            defaultValue: { type: "money_cents", amountCents: 0 },
          },
        },
      }).codes,
    ).toEqual([]);
  });

  it("fails closed when missing-data impact facts are missing, malformed, or inconsistent", () => {
    const input = safeInput();
    const explicitDefaultContract = {
      ...input.contract,
      missingDataPolicy: {
        action: "use_explicit_default" as const,
        defaultValue: { type: "money_cents" as const, amountCents: 0 },
      },
    };

    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        simulation: {
          ...input.simulation,
          missingDataImpact: undefined as never,
        },
        contract: explicitDefaultContract,
      }),
    ).toThrow(/missingDataImpact/i);
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        simulation: {
          ...input.simulation,
          missingDataImpact: {
            policyAction: "use_explicit_default",
            amountDeltaCents: "not-cents",
          },
        },
        contract: explicitDefaultContract,
      }),
    ).toThrow(/amountDeltaCents/i);
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        simulation: {
          ...input.simulation,
          missingDataImpact: {
            policyAction: "use_explicit_default",
            amountDeltaCents: "0",
          },
        },
      }),
    ).toThrow(/policy action/i);
  });

  it("fails closed for missing or inconsistent group-conflict facts", () => {
    const input = safeInput();
    const groupTargetContract = {
      ...input.contract,
      target: {
        targetType: "streamer_group" as const,
        targetId: "group-primary",
      },
    };

    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        contract: {
          ...groupTargetContract,
          groupConflict: undefined as never,
        },
      }),
    ).toThrow(/groupConflict/i);
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        contract: {
          ...groupTargetContract,
          groupConflict: {
            resolution: "explicit_exception",
            conflictingGroupIds: [],
          },
        },
      }),
    ).toThrow(/conflictingGroupIds/i);
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        contract: {
          ...groupTargetContract,
          groupConflict: {
            resolution: "none",
            conflictingGroupIds: ["group-conflict-a"],
          },
        },
      }),
    ).toThrow(/resolution/i);
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...input,
        contract: {
          ...input.contract,
          groupConflict: {
            resolution: "explicit_exception",
            conflictingGroupIds: ["group-conflict-a"],
          },
        },
      }),
    ).toThrow(/streamer-group target/i);
  });

  it("rejects malformed server configuration instead of silently weakening it", () => {
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...safeInput(),
        configuration: {
          organization: {
            abnormalTotalIncreaseBps: -1,
            safetyCapCents: "100000",
          },
        },
      }),
    ).toThrow(/abnormalTotalIncreaseBps/);
    expect(() =>
      analyzeCustomRuleMaterialRisk({
        ...safeInput(),
        configuration: {
          project: {
            abnormalTotalIncreaseBps: 2_000,
            safetyCapCents: "not-cents",
          },
        },
      }),
    ).toThrow(/safetyCapCents/);
  });
});
