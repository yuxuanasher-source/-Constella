import { describe, expect, it } from "vitest";

import {
  CustomRuleExecutionError,
  applyMissingDataPoliciesBeforeExecution,
  type MissingDataVariableDeclaration,
} from "./custom-rule-missing-data";
import type { CustomRuleTarget, TypedRuntimeValue } from "./custom-rule-types";

const TARGET: CustomRuleTarget = { targetType: "project", targetId: null };

describe("applyMissingDataPoliciesBeforeExecution", () => {
  it("blocks when a required variable is missing", () => {
    const prepared = prepare({
      variables: {},
      declarations: [required("settlement_minutes")],
    });

    expect(prepared.kind).toBe("blocked");
    if (prepared.kind !== "blocked") throw new Error("expected blocked");
    expect(prepared.error).toBeInstanceOf(CustomRuleExecutionError);
    expect(prepared.error.issue).toEqual({
      code: "CUSTOM_RULE_REQUIRED_INPUT_MISSING",
      message: "Required custom settlement input is missing",
      context: {
        ruleVersionId: "rule-v1",
        target: TARGET,
        layer: "project_base",
        executionUnitKey: "unit-1",
        variable: "settlement_minutes",
        category: "formula_input",
      },
    });
  });

  it("blocks optional block_batch misses before any batch transaction", () => {
    const prepared = prepare({
      variables: {},
      declarations: [
        optional("sales_amount", {
          category: "optional_input",
          missingDataPolicy: { action: "block_batch" },
        }),
      ],
    });

    expect(prepared).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_MISSING_DATA_BLOCKED",
          context: {
            variable: "sales_amount",
            category: "optional_input",
          },
        },
      },
    });
    if (prepared.kind !== "blocked") throw new Error("expected blocked");
    expect(prepared.error.noTransactionAttempted).toBe(true);
  });

  it("routes exact declared optional-input misses to review placeholders", () => {
    const prepared = prepare({
      variables: {},
      declarations: [
        optional("gift_amount", {
          category: "optional_input",
          missingDataPolicy: { action: "route_item_to_review" },
        }),
      ],
    });

    expect(prepared).toEqual({
      kind: "review",
      exceptions: [
        {
          ruleVersionId: "rule-v1",
          target: TARGET,
          layer: "project_base",
          executionUnitKey: "unit-1",
          variable: "gift_amount",
          category: "optional_input",
          policy: "route_item_to_review",
          placeholderAmountCents: 0,
          contributionCents: 0,
          status: "review_required",
        },
      ],
    });
  });

  it("applies typed explicit defaults and records ready decisions", () => {
    const prepared = prepare({
      variables: {},
      declarations: [
        optional("orders_count", {
          category: "optional_input",
          valueType: { kind: "scalar", scalarType: "integer" },
          missingDataPolicy: {
            action: "use_explicit_default",
            defaultValue: integer(0),
          },
        }),
      ],
    });

    expect(prepared).toEqual({
      kind: "ready",
      variables: {
        orders_count: integer(0),
      },
      decisions: [
        {
          ruleVersionId: "rule-v1",
          target: TARGET,
          layer: "project_base",
          executionUnitKey: "unit-1",
          variable: "orders_count",
          category: "optional_input",
          action: "use_explicit_default",
          value: integer(0),
        },
      ],
    });
  });

  it("blocks explicit defaults for identity and evidence fields", () => {
    const prepared = prepare({
      variables: {},
      declarations: [
        optional("streamer_id", {
          category: "identity",
          valueType: { kind: "scalar", scalarType: "string" },
          missingDataPolicy: {
            action: "use_explicit_default",
            defaultValue: { type: "string", value: "streamer-x" },
          },
        }),
      ],
    });

    expect(prepared).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_FORBIDDEN_EXPLICIT_DEFAULT",
          context: {
            variable: "streamer_id",
            category: "identity",
          },
        },
      },
    });
  });

  it("chooses the most conservative outcome across multiple missing variables", () => {
    const withDefaultAndReview = prepare({
      variables: {},
      declarations: [
        optional("orders_count", {
          category: "optional_input",
          valueType: { kind: "scalar", scalarType: "integer" },
          missingDataPolicy: {
            action: "use_explicit_default",
            defaultValue: integer(0),
          },
        }),
        optional("gift_amount", {
          category: "optional_input",
          missingDataPolicy: { action: "route_item_to_review" },
        }),
      ],
    });
    const withBlockAndReview = prepare({
      variables: {},
      declarations: [
        optional("gift_amount", {
          category: "optional_input",
          missingDataPolicy: { action: "route_item_to_review" },
        }),
        optional("sales_amount", {
          category: "optional_input",
          missingDataPolicy: { action: "block_batch" },
        }),
      ],
    });

    expect(withDefaultAndReview.kind).toBe("review");
    expect(withBlockAndReview.kind).toBe("blocked");
  });

  it("blocks an optional missing variable with no declared policy", () => {
    const prepared = prepare({
      variables: {},
      declarations: [optional("external_cost", { category: "optional_input" })],
    });

    expect(prepared).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_UNDECLARED_MISSING_DATA_POLICY",
          context: {
            variable: "external_cost",
            category: "optional_input",
          },
        },
      },
    });
  });

  it("blocks route_item_to_review unless the miss is an exact declared optional input", () => {
    const prepared = prepare({
      variables: {},
      declarations: [
        optional("provider_invoice_id", {
          category: "provider_data",
          missingDataPolicy: { action: "route_item_to_review" },
        }),
      ],
    });

    expect(prepared).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_REVIEW_POLICY_NOT_ALLOWED",
          context: {
            variable: "provider_invoice_id",
            category: "provider_data",
          },
        },
      },
    });
  });
});

function prepare(input: {
  variables: Record<string, TypedRuntimeValue>;
  declarations: MissingDataVariableDeclaration[];
}) {
  return applyMissingDataPoliciesBeforeExecution({
    ruleVersionId: "rule-v1",
    target: TARGET,
    layer: "project_base",
    executionUnitKey: "unit-1",
    variables: input.variables,
    declarations: input.declarations,
  });
}

function required(name: string): MissingDataVariableDeclaration {
  return {
    name,
    required: true,
    category: "formula_input",
    valueType: { kind: "scalar", scalarType: "integer" },
  };
}

function optional(
  name: string,
  overrides: Omit<Partial<MissingDataVariableDeclaration>, "name" | "required">,
): MissingDataVariableDeclaration {
  return {
    name,
    required: false,
    category: "optional_input",
    valueType: { kind: "scalar", scalarType: "money_cents" },
    ...overrides,
  };
}

function integer(value: number): TypedRuntimeValue {
  return { type: "integer", value };
}
