import { describe, expect, it } from "vitest";

import { businessRuleContractSchema } from "./custom-rule-contract";
import {
  CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS,
  getCustomRuleSystemTemplate,
  listCustomRuleSystemTemplates,
} from "./custom-rule-system-templates";

const EXPECTED_IDS = [
  "system:cpt:v1",
  "system:cps:v1",
  "system:base-plus-performance:v1",
  "system:base-plus-tiered-cpt:v1",
  "system:base-plus-cps:v1",
  "system:evidence-discount:v1",
  "system:floor-cap:v1",
  "system:group-bonus:v1",
];

describe("custom rule system templates", () => {
  it("lists common industry contracts in stable business order", () => {
    const templates = listCustomRuleSystemTemplates();

    expect(templates.map((template) => template.id)).toEqual(EXPECTED_IDS);
    expect(templates.map((template) => template.kind)).toEqual([
      "cpt",
      "cps",
      "base_plus_performance",
      "base_plus_tiered_cpt",
      "base_plus_cps",
      "evidence_discount",
      "floor_cap",
      "group_bonus",
    ]);
  });

  it("returns fresh editable contracts that all pass the Task 2 schema", () => {
    const first = listCustomRuleSystemTemplates();
    const second = listCustomRuleSystemTemplates();

    for (const template of first) {
      expect(() => businessRuleContractSchema.parse(template.contract)).not.toThrow();
      expect(Object.isFrozen(template)).toBe(false);
      expect(Object.isFrozen(template.contract)).toBe(false);
    }
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].contract).not.toBe(second[0].contract);

    first[0].contract.summary = "编辑后的按场直播时长结算规则。";
    first[0].contract.parameters[0].defaultValue = {
      type: "money_cents",
      amountCents: 12_000,
    };

    expect(second[0].contract.summary).not.toBe(first[0].contract.summary);
    expect(second[0].contract.parameters[0].defaultValue).toEqual({
      type: "money_cents",
      amountCents: 10_000,
    });
    expect(() => businessRuleContractSchema.parse(first[0].contract)).not.toThrow();
  });

  it("deep-freezes canonical definitions without sharing returned copies", () => {
    expect(Object.isFrozen(CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS)).toBe(true);
    for (const definition of CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS) {
      expectRecursivelyFrozen(definition);
    }

    const returned = getCustomRuleSystemTemplate("system:cps:v1");
    expect(returned).not.toBeNull();
    expect(returned?.contract).not.toBe(
      CUSTOM_RULE_SYSTEM_TEMPLATE_DEFINITIONS[1].contract,
    );
    expect(Object.isFrozen(returned?.contract)).toBe(false);
    expect(getCustomRuleSystemTemplate("system:unknown:v1")).toBeNull();
  });

  it("contains no executable, lifecycle, database, or user-owned fields", () => {
    const forbiddenKeys = new Set([
      "active",
      "activationFlags",
      "compiledAst",
      "databaseId",
      "formula",
      "formulaHash",
      "ruleVersion",
      "ruleVersionId",
      "userId",
      "userValue",
    ]);

    for (const template of listCustomRuleSystemTemplates()) {
      const keys = collectKeys(template);
      for (const forbidden of forbiddenKeys) {
        expect(keys).not.toContain(forbidden);
      }
      expect(template.contract.target.targetId).toBeNull();
    }
  });

  it("keeps IDs, order, and returned JSON deterministic across calls", () => {
    const first = listCustomRuleSystemTemplates();
    const second = listCustomRuleSystemTemplates();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map((template) => template.id)).toEqual(EXPECTED_IDS);
  });
});

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) expectRecursivelyFrozen(descriptor.value);
  }
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (value === null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    keys.push(key);
    if ("value" in descriptor) collectKeys(descriptor.value, keys);
  }
  return keys;
}
