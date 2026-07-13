import type { AppRole } from "@/lib/rbac/roles";

import type {
  CustomRulePrimaryActionDto,
  CustomRuleSimulationFreshnessHashes,
  CustomRuleVersionStatus,
  MaterialRiskCode,
} from "./custom-rule-types";

export const CUSTOM_RULE_GOVERNANCE_CAPABILITIES = Object.freeze([
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
] as const);

export type CustomRuleGovernanceCapability =
  (typeof CUSTOM_RULE_GOVERNANCE_CAPABILITIES)[number];

const ALLOWED_TRANSITIONS = {
  draft: ["pending_review", "archived"],
  pending_review: ["changes_requested", "active"],
  changes_requested: ["draft", "archived"],
  active: ["archived"],
  archived: [],
} as const satisfies Readonly<
  Record<CustomRuleVersionStatus, readonly CustomRuleVersionStatus[]>
>;

function freezeCapabilities(
  ...capabilities: CustomRuleGovernanceCapability[]
): readonly CustomRuleGovernanceCapability[] {
  return Object.freeze(capabilities);
}

const ROLE_CAPABILITIES = Object.freeze({
  owner: freezeCapabilities(...CUSTOM_RULE_GOVERNANCE_CAPABILITIES),
  ops_manager: freezeCapabilities(
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
  ),
  finance: freezeCapabilities(
    "view_internal",
    "simulate",
    "comment",
    "request_changes",
  ),
  operator_business: freezeCapabilities(
    "view_internal",
    "create_draft",
    "edit_draft",
    "use_ai",
    "simulate",
    "submit_review",
  ),
  streamer: freezeCapabilities(),
} satisfies Readonly<
  Record<AppRole, readonly CustomRuleGovernanceCapability[]>
>);

export class CustomRuleGovernanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CustomRuleGovernanceError";
  }
}

export function canTransitionCustomRuleState(
  from: CustomRuleVersionStatus,
  to: CustomRuleVersionStatus,
): boolean {
  const allowed: readonly CustomRuleVersionStatus[] = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

export function assertCustomRuleTransition(
  from: CustomRuleVersionStatus,
  to: CustomRuleVersionStatus,
): void {
  if (!canTransitionCustomRuleState(from, to)) {
    throw new CustomRuleGovernanceError(
      "CUSTOM_RULE_TRANSITION_NOT_ALLOWED",
      `Custom settlement rule transition ${from} -> ${to} is not allowed`,
    );
  }
}

export function assertCustomRulePayloadEditable(
  status: CustomRuleVersionStatus,
): void {
  if (status !== "draft") {
    throw new CustomRuleGovernanceError(
      "CUSTOM_RULE_PAYLOAD_IMMUTABLE",
      `Rule payload is immutable while ${status}; reopen or create a draft before editing`,
    );
  }
}

export function canDeleteCustomRuleVersion(
  status: CustomRuleVersionStatus,
): false {
  void status;
  return false;
}

export function getPrimaryActionForRuleState(
  state: CustomRuleVersionStatus,
): CustomRulePrimaryActionDto {
  switch (state) {
    case "draft":
      return { state, action: "apply_and_submit" };
    case "pending_review":
      return { state, action: "approve" };
    case "changes_requested":
      return { state, action: "revise_and_resimulate" };
    case "active":
      return { state, action: "create_new_version" };
    case "archived":
      return { state, action: "none" };
  }
}

export function getCustomRuleGovernanceCapabilities(
  role: AppRole,
): readonly CustomRuleGovernanceCapability[] {
  return ROLE_CAPABILITIES[role];
}

export function canRolePerformCustomRuleGovernanceAction(
  role: AppRole,
  capability: CustomRuleGovernanceCapability,
): boolean {
  const capabilities: readonly CustomRuleGovernanceCapability[] =
    ROLE_CAPABILITIES[role];
  return capabilities.includes(capability);
}

type EligibleCustomRuleApprover = Readonly<{
  userId: string;
  role: "owner" | "ops_manager";
}>;

type CustomRuleApprovalPolicyBase = Readonly<{
  actor: Readonly<{ userId: string; role: AppRole }>;
  creatorUserId: string;
  eligibleApprovers: readonly EligibleCustomRuleApprover[];
  materialRiskCodes: readonly MaterialRiskCode[];
}>;

export type CustomRuleApprovalPolicyInput =
  | (CustomRuleApprovalPolicyBase & { mode: "standard" })
  | (CustomRuleApprovalPolicyBase & {
      mode: "force";
      acknowledgement: string | null | undefined;
      reason: string;
    });

export const CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK";

const DEFAULT_IGNORABLE_CODE_POINT_PATTERN =
  /\p{Default_Ignorable_Code_Point}+/gu;
const AUDIT_REASON_CONTENT_PATTERN = /[\p{L}\p{N}]/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export type CustomRuleApprovalDecision =
  | Readonly<{ allowed: true; mode: "standard" | "force" }>
  | Readonly<{ allowed: false; code: string; reason: string }>;

export function evaluateCustomRuleApproval(
  input: CustomRuleApprovalPolicyInput,
): CustomRuleApprovalDecision {
  if (input.mode === "force") {
    return evaluateForceApproval(input);
  }

  if (
    !canRolePerformCustomRuleGovernanceAction(
      input.actor.role,
      "standard_approve",
    )
  ) {
    return denied(
      "STANDARD_APPROVAL_NOT_ALLOWED",
      "Current role cannot approve custom settlement rules",
    );
  }
  if (!isEligibleApprover(input)) {
    return denied(
      "APPROVER_NOT_ELIGIBLE",
      "Current actor is not in the server-authorized approver set",
    );
  }

  if (input.materialRiskCodes.length > 0) {
    if (input.actor.role !== "owner") {
      return denied(
        "MATERIAL_RISK_REQUIRES_OWNER",
        "Material-risk custom settlement rules require owner approval",
      );
    }
    if (input.actor.userId === input.creatorUserId) {
      return denied(
        "MATERIAL_RISK_REQUIRES_DISTINCT_OWNER",
        "Material-risk custom settlement rules require an owner other than the creator",
      );
    }
  }

  const anotherEligibleApproverExists = input.eligibleApprovers.some(
    (approver) => approver.userId !== input.creatorUserId,
  );
  if (
    input.actor.userId === input.creatorUserId &&
    anotherEligibleApproverExists
  ) {
    return denied(
      "CREATOR_APPROVAL_REQUIRES_DISTINCT_APPROVER",
      "Another eligible approver must approve a rule created by the current actor",
    );
  }

  return { allowed: true, mode: "standard" };
}

export function assertCustomRuleApprovalAllowed(
  input: CustomRuleApprovalPolicyInput,
): void {
  const decision = evaluateCustomRuleApproval(input);
  if (!decision.allowed) {
    throw new CustomRuleGovernanceError(decision.code, decision.reason);
  }
}

function evaluateForceApproval(
  input: Extract<CustomRuleApprovalPolicyInput, { mode: "force" }>,
): CustomRuleApprovalDecision {
  if (
    input.actor.role !== "owner" ||
    !canRolePerformCustomRuleGovernanceAction(input.actor.role, "force_approve")
  ) {
    return denied(
      "FORCE_APPROVAL_OWNER_ONLY",
      "Only an owner can force approve a custom settlement rule",
    );
  }

  const eligibleOwners = new Set(
    input.eligibleApprovers
      .filter((approver) => approver.role === "owner")
      .map((approver) => approver.userId),
  );
  if (
    eligibleOwners.size !== 1 ||
    !eligibleOwners.has(input.actor.userId) ||
    !isEligibleApprover(input)
  ) {
    return denied(
      "FORCE_APPROVAL_REQUIRES_SINGLE_OWNER",
      "Force approval is available only when the current actor is the sole eligible owner",
    );
  }
  if (input.materialRiskCodes.length === 0) {
    const eligibleApproverIds = new Set(
      input.eligibleApprovers.map((approver) => approver.userId),
    );
    if (
      eligibleApproverIds.size !== 1 ||
      !eligibleApproverIds.has(input.actor.userId)
    ) {
      return denied(
        "FORCE_APPROVAL_REQUIRES_SOLE_ELIGIBLE_APPROVER",
        "Standard-risk force approval is available only to the sole eligible approver",
      );
    }
  }
  if (input.acknowledgement !== CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT) {
    return denied(
      "FORCE_ACKNOWLEDGEMENT_REQUIRED",
      "Force approval requires an explicit risk acknowledgement",
    );
  }
  if (!hasMeaningfulForceReason(input.reason)) {
    return denied(
      "FORCE_REASON_REQUIRED",
      "Force approval requires an audit reason containing a letter or number",
    );
  }

  return { allowed: true, mode: "force" };
}

function hasMeaningfulForceReason(reason: unknown): boolean {
  if (typeof reason !== "string") return false;

  const visibleReason = reason
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE_CODE_POINT_PATTERN, "");
  return AUDIT_REASON_CONTENT_PATTERN.test(visibleReason);
}

function isEligibleApprover(input: CustomRuleApprovalPolicyBase): boolean {
  return input.eligibleApprovers.some(
    (approver) =>
      approver.userId === input.actor.userId &&
      approver.role === input.actor.role,
  );
}

function denied(code: string, reason: string): CustomRuleApprovalDecision {
  return { allowed: false, code, reason };
}

const FRESHNESS_FIELDS = [
  ["formulaHash", "formula_hash"],
  ["contractHash", "contract_hash"],
  ["parameterHash", "parameter_hash"],
  ["catalogHash", "catalog_hash"],
  ["dataSelectionHash", "data_selection_hash"],
] as const satisfies readonly (readonly [
  keyof CustomRuleSimulationFreshnessHashes,
  string,
])[];

export function assertSimulationFresh(input: {
  expected: CustomRuleSimulationFreshnessHashes;
  simulation: CustomRuleSimulationFreshnessHashes;
}): void {
  for (const [field, storageName] of FRESHNESS_FIELDS) {
    const expected = input.expected[field];
    const actual = input.simulation[field];
    const expectedIssue = getHashCanonicalityIssue(expected);
    if (expectedIssue !== null) {
      throw new CustomRuleGovernanceError(
        "SIMULATION_FRESHNESS_BASELINE_INVALID",
        `${storageName} server baseline is ${expectedIssue}; refresh or repair the server baseline before submitting or approving`,
      );
    }
    const simulationIssue = getHashCanonicalityIssue(actual);
    if (simulationIssue !== null) {
      throw new CustomRuleGovernanceError(
        "SIMULATION_FRESHNESS_HASH_INVALID",
        `${storageName} simulation hash is ${simulationIssue}; run a new simulation before submitting or approving`,
      );
    }
    if (expected !== actual) {
      throw new CustomRuleGovernanceError(
        "SIMULATION_STALE",
        `${storageName} changed; run a new simulation before submitting or approving`,
      );
    }
  }
}

function getHashCanonicalityIssue(
  value: string | null | undefined,
): "missing" | "non-canonical" | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "missing";
  }
  return HASH_PATTERN.test(value) ? null : "non-canonical";
}
