import { describe, expect, it } from "vitest";

import {
  CUSTOM_RULE_GOVERNANCE_CAPABILITIES,
  CustomRuleGovernanceError,
  assertCustomRuleApprovalAllowed,
  assertCustomRulePayloadEditable,
  assertCustomRuleTransition,
  assertSimulationFresh,
  canDeleteCustomRuleVersion,
  canRolePerformCustomRuleGovernanceAction,
  canTransitionCustomRuleState,
  evaluateCustomRuleApproval,
  getCustomRuleGovernanceCapabilities,
  getPrimaryActionForRuleState,
} from "./custom-rule-governance";
import {
  CUSTOM_RULE_VERSION_STATUSES,
  type CustomRuleSimulationFreshnessHashes,
} from "./custom-rule-types";

const ALLOWED_TRANSITIONS = new Set([
  "draft->pending_review",
  "pending_review->changes_requested",
  "changes_requested->draft",
  "pending_review->active",
  "active->archived",
  "draft->archived",
  "changes_requested->archived",
]);

const REVIEWED_GOVERNANCE_CAPABILITIES = [
  "view_internal",
  "create_draft",
  "edit_draft",
  "use_ai",
  "simulate",
  "submit_review",
  "standard_approve",
  "force_approve",
  "comment",
  "request_changes",
  "archive_rule",
  "manage_groups",
  "assign_groups",
  "manage_templates",
] as const;

const REVIEWED_ROLE_CAPABILITIES = [
  {
    role: "owner",
    allowed: [
      "view_internal",
      "create_draft",
      "edit_draft",
      "use_ai",
      "simulate",
      "submit_review",
      "standard_approve",
      "force_approve",
      "comment",
      "request_changes",
      "archive_rule",
      "manage_groups",
      "assign_groups",
      "manage_templates",
    ],
  },
  {
    role: "ops_manager",
    allowed: [
      "view_internal",
      "create_draft",
      "edit_draft",
      "use_ai",
      "simulate",
      "submit_review",
      "standard_approve",
      "comment",
      "request_changes",
      "archive_rule",
      "manage_groups",
      "assign_groups",
      "manage_templates",
    ],
  },
  {
    role: "finance",
    allowed: ["view_internal", "simulate", "comment", "request_changes"],
  },
  {
    role: "operator_business",
    allowed: [
      "view_internal",
      "create_draft",
      "edit_draft",
      "use_ai",
      "simulate",
      "submit_review",
    ],
  },
  { role: "streamer", allowed: [] },
] as const;

describe("custom rule lifecycle governance", () => {
  it("allows exactly the seven governed lifecycle transitions", () => {
    for (const from of CUSTOM_RULE_VERSION_STATUSES) {
      for (const to of CUSTOM_RULE_VERSION_STATUSES) {
        const expected = ALLOWED_TRANSITIONS.has(`${from}->${to}`);

        expect(canTransitionCustomRuleState(from, to), `${from} -> ${to}`).toBe(
          expected,
        );
      }
    }
  });

  it("rejects direct activation, archived reactivation, and unknown transitions", () => {
    expect(() => assertCustomRuleTransition("draft", "active")).toThrow(
      CustomRuleGovernanceError,
    );
    expect(() => assertCustomRuleTransition("archived", "draft")).toThrow(
      /archived -> draft/,
    );
    expect(() =>
      assertCustomRuleTransition("active", "pending_review"),
    ).toThrow(/active -> pending_review/);
  });

  it("allows payload edits only in draft and never allows version deletion", () => {
    expect(() => assertCustomRulePayloadEditable("draft")).not.toThrow();

    for (const status of [
      "pending_review",
      "changes_requested",
      "active",
      "archived",
    ] as const) {
      expect(() => assertCustomRulePayloadEditable(status)).toThrow(
        /reopen or create a draft/i,
      );
    }

    for (const status of CUSTOM_RULE_VERSION_STATUSES) {
      expect(canDeleteCustomRuleVersion(status), status).toBe(false);
    }
  });

  it("returns one state-aware primary action for every version state", () => {
    expect(
      CUSTOM_RULE_VERSION_STATUSES.map(getPrimaryActionForRuleState),
    ).toEqual([
      { state: "draft", action: "apply_and_submit" },
      { state: "pending_review", action: "approve" },
      { state: "changes_requested", action: "revise_and_resimulate" },
      { state: "active", action: "create_new_version" },
      { state: "archived", action: "none" },
    ]);
  });
});

describe("custom rule role capabilities", () => {
  it.each(REVIEWED_ROLE_CAPABILITIES)(
    "$role has exactly the reviewed allowed and denied capabilities",
    ({ role, allowed }) => {
      expect(getCustomRuleGovernanceCapabilities(role)).toEqual(allowed);

      const allowedCapabilities: readonly string[] = allowed;
      for (const capability of REVIEWED_GOVERNANCE_CAPABILITIES) {
        expect(
          canRolePerformCustomRuleGovernanceAction(role, capability),
          `${role}:${capability}`,
        ).toBe(allowedCapabilities.includes(capability));
      }
    },
  );

  it("keeps exported and per-role capability policies immutable at runtime", () => {
    expect(Object.isFrozen(CUSTOM_RULE_GOVERNANCE_CAPABILITIES)).toBe(true);
    expect(() =>
      (CUSTOM_RULE_GOVERNANCE_CAPABILITIES as unknown as string[]).splice(0, 1),
    ).toThrow();

    for (const { role, allowed } of REVIEWED_ROLE_CAPABILITIES) {
      const capabilities = getCustomRuleGovernanceCapabilities(role);
      expect(Object.isFrozen(capabilities), role).toBe(true);
      expect(() =>
        (capabilities as unknown as string[]).push("forged_capability"),
      ).toThrow();
      expect(getCustomRuleGovernanceCapabilities(role)).toEqual(allowed);
    }
    expect(
      canRolePerformCustomRuleGovernanceAction("finance", "standard_approve"),
    ).toBe(false);
  });
});

describe("custom rule approval policy", () => {
  const creatorId = "user-creator";
  const ownerId = "user-owner";
  const opsId = "user-ops";
  const eligibleApprovers = [
    { userId: ownerId, role: "owner" as const },
    { userId: opsId, role: "ops_manager" as const },
  ];

  it("blocks creator standard approval when another eligible approver exists", () => {
    expect(
      evaluateCustomRuleApproval({
        mode: "standard",
        actor: { userId: opsId, role: "ops_manager" },
        creatorUserId: opsId,
        eligibleApprovers,
        materialRiskCodes: [],
      }),
    ).toMatchObject({
      allowed: false,
      code: "CREATOR_APPROVAL_REQUIRES_DISTINCT_APPROVER",
    });
  });

  it("allows a sole eligible creator to standard approve a standard-risk rule", () => {
    expect(
      evaluateCustomRuleApproval({
        mode: "standard",
        actor: { userId: opsId, role: "ops_manager" },
        creatorUserId: opsId,
        eligibleApprovers: [{ userId: opsId, role: "ops_manager" }],
        materialRiskCodes: [],
      }),
    ).toEqual({ allowed: true, mode: "standard" });
  });

  it("requires a different eligible owner for standard material-risk approval", () => {
    const risks = ["negative_margin" as const];

    expect(
      evaluateCustomRuleApproval({
        mode: "standard",
        actor: { userId: opsId, role: "ops_manager" },
        creatorUserId: creatorId,
        eligibleApprovers,
        materialRiskCodes: risks,
      }),
    ).toMatchObject({ allowed: false, code: "MATERIAL_RISK_REQUIRES_OWNER" });
    expect(
      evaluateCustomRuleApproval({
        mode: "standard",
        actor: { userId: ownerId, role: "owner" },
        creatorUserId: ownerId,
        eligibleApprovers,
        materialRiskCodes: risks,
      }),
    ).toMatchObject({
      allowed: false,
      code: "MATERIAL_RISK_REQUIRES_DISTINCT_OWNER",
    });
    expect(
      evaluateCustomRuleApproval({
        mode: "standard",
        actor: { userId: ownerId, role: "owner" },
        creatorUserId: creatorId,
        eligibleApprovers,
        materialRiskCodes: risks,
      }),
    ).toEqual({ allowed: true, mode: "standard" });
  });

  it("allows force approval only to the sole eligible owner with acknowledgment and reason", () => {
    const base = {
      mode: "force" as const,
      actor: { userId: ownerId, role: "owner" as const },
      creatorUserId: ownerId,
      eligibleApprovers: [{ userId: ownerId, role: "owner" as const }],
      materialRiskCodes: ["negative_margin" as const],
    };

    expect(
      evaluateCustomRuleApproval({
        ...base,
        acknowledgement: "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK",
        reason: "Single-owner emergency approval after reviewing the risk.",
      }),
    ).toEqual({ allowed: true, mode: "force" });
    expect(
      evaluateCustomRuleApproval({
        ...base,
        acknowledgement: "I_UNDERSTAND",
        reason: "Reviewed.",
      }),
    ).toMatchObject({ allowed: false, code: "FORCE_ACKNOWLEDGEMENT_REQUIRED" });
    expect(
      evaluateCustomRuleApproval({
        ...base,
        acknowledgement: "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK",
        reason: "   ",
      }),
    ).toMatchObject({ allowed: false, code: "FORCE_REASON_REQUIRED" });
  });

  it("never exposes force approval to ops managers or multi-owner organizations", () => {
    expect(
      evaluateCustomRuleApproval({
        mode: "force",
        actor: { userId: opsId, role: "ops_manager" },
        creatorUserId: opsId,
        eligibleApprovers: [{ userId: opsId, role: "ops_manager" }],
        materialRiskCodes: [],
        acknowledgement: "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK",
        reason: "Attempted force approval.",
      }),
    ).toMatchObject({ allowed: false, code: "FORCE_APPROVAL_OWNER_ONLY" });

    expect(
      evaluateCustomRuleApproval({
        mode: "force",
        actor: { userId: ownerId, role: "owner" },
        creatorUserId: ownerId,
        eligibleApprovers: [
          { userId: ownerId, role: "owner" },
          { userId: "user-owner-2", role: "owner" },
        ],
        materialRiskCodes: [],
        acknowledgement: "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK",
        reason: "Attempted force approval.",
      }),
    ).toMatchObject({
      allowed: false,
      code: "FORCE_APPROVAL_REQUIRES_SINGLE_OWNER",
    });
  });

  it("isolates force approval by material risk and the complete eligible approver set", () => {
    const forceCommand = {
      mode: "force" as const,
      actor: { userId: ownerId, role: "owner" as const },
      creatorUserId: ownerId,
      acknowledgement: "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK",
      reason: "已复核单一负责人审批风险",
    };
    const ownerAndOps = [
      { userId: ownerId, role: "owner" as const },
      { userId: opsId, role: "ops_manager" as const },
    ];

    expect(
      evaluateCustomRuleApproval({
        ...forceCommand,
        eligibleApprovers: ownerAndOps,
        materialRiskCodes: [],
      }),
    ).toMatchObject({
      allowed: false,
      code: "FORCE_APPROVAL_REQUIRES_SOLE_ELIGIBLE_APPROVER",
    });
    expect(
      evaluateCustomRuleApproval({
        ...forceCommand,
        eligibleApprovers: ownerAndOps,
        materialRiskCodes: ["negative_margin"],
      }),
    ).toEqual({ allowed: true, mode: "force" });
    expect(
      evaluateCustomRuleApproval({
        ...forceCommand,
        eligibleApprovers: [{ userId: ownerId, role: "owner" }],
        materialRiskCodes: [],
      }),
    ).toEqual({ allowed: true, mode: "force" });
  });

  it("requires a force reason containing a Unicode letter or number", () => {
    const base = {
      mode: "force" as const,
      actor: { userId: ownerId, role: "owner" as const },
      creatorUserId: ownerId,
      eligibleApprovers: [{ userId: ownerId, role: "owner" as const }],
      materialRiskCodes: ["negative_margin" as const],
      acknowledgement: "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK",
    };

    for (const reason of [
      "\u200B",
      "\u3164",
      "\uFFA0",
      "\u115F",
      "\u200B\u3164\u2060\uFFA0\u115F\u00AD",
      "!!!，。",
      "---___",
      null,
      undefined,
    ] as const) {
      expect(
        evaluateCustomRuleApproval({ ...base, reason: reason as never }),
        String(reason),
      ).toMatchObject({
        allowed: false,
        code: "FORCE_REASON_REQUIRED",
      });
    }
    for (const reason of [
      "已复核风险",
      "Reviewed risk 2026",
      "已\u200B复核 2026",
    ]) {
      expect(evaluateCustomRuleApproval({ ...base, reason }), reason).toEqual({
        allowed: true,
        mode: "force",
      });
    }
  });

  it("rejects actors missing from the server-owned eligible approver set", () => {
    const input = {
      mode: "standard" as const,
      actor: { userId: "unlisted-owner", role: "owner" as const },
      creatorUserId: creatorId,
      eligibleApprovers,
      materialRiskCodes: [],
    };

    expect(evaluateCustomRuleApproval(input)).toMatchObject({
      allowed: false,
      code: "APPROVER_NOT_ELIGIBLE",
    });
    expect(() => assertCustomRuleApprovalAllowed(input)).toThrow(
      CustomRuleGovernanceError,
    );
  });
});

describe("simulation freshness", () => {
  const hashes: CustomRuleSimulationFreshnessHashes = {
    formulaHash: "a".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    catalogHash: "d".repeat(64),
    dataSelectionHash: "e".repeat(64),
  };

  it("accepts only a complete matching five-hash snapshot", () => {
    expect(() =>
      assertSimulationFresh({ expected: hashes, simulation: hashes }),
    ).not.toThrow();
  });

  const freshnessFields = [
    ["formulaHash", "formula_hash"],
    ["contractHash", "contract_hash"],
    ["parameterHash", "parameter_hash"],
    ["catalogHash", "catalog_hash"],
    ["dataSelectionHash", "data_selection_hash"],
  ] as const;

  function invalidHashValues(
    validHash: string,
  ): readonly (string | null | undefined)[] {
    return [
      null,
      undefined,
      "",
      "   ",
      validHash.slice(0, 63),
      validHash.toUpperCase(),
      `${validHash.slice(0, 32)}\u200B${validHash.slice(32)}`,
      ` ${validHash} `,
    ];
  }

  it.each(freshnessFields)(
    "points to the server baseline when expected %s is missing or non-canonical",
    (field, label) => {
      const validHash = hashes[field] as string;
      for (const invalid of invalidHashValues(validHash)) {
        expect(() =>
          assertSimulationFresh({
            expected: { ...hashes, [field]: invalid },
            simulation: hashes,
          }),
        ).toThrow(
          new RegExp(`${label}.*server baseline.*(refresh|repair)`, "i"),
        );
      }
    },
  );

  it.each(freshnessFields)(
    "points to resimulation when simulation %s is missing or non-canonical",
    (field, label) => {
      const validHash = hashes[field] as string;
      for (const invalid of invalidHashValues(validHash)) {
        expect(() =>
          assertSimulationFresh({
            expected: hashes,
            simulation: { ...hashes, [field]: invalid },
          }),
        ).toThrow(
          new RegExp(`${label}.*simulation.*run a new simulation`, "i"),
        );
      }
    },
  );

  it.each(freshnessFields)(
    "rejects matching %s values when both sides contain surrounding whitespace",
    (field, label) => {
      const padded = ` ${hashes[field]} `;

      expect(() =>
        assertSimulationFresh({
          expected: { ...hashes, [field]: padded },
          simulation: { ...hashes, [field]: padded },
        }),
      ).toThrow(new RegExp(`${label}.*server baseline.*(refresh|repair)`, "i"));
    },
  );

  it.each(freshnessFields)(
    "returns stale only when simulation %s is a different valid hash",
    (field, label) => {
      let thrown: unknown;
      try {
        assertSimulationFresh({
          expected: hashes,
          simulation: { ...hashes, [field]: "f".repeat(64) },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: "SIMULATION_STALE",
        message: expect.stringMatching(
          new RegExp(`${label}.*run a new simulation`, "i"),
        ),
      });
    },
  );
});
