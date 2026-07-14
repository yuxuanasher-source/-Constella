import { describe, expect, it } from "vitest";

import {
  applyRuleParameterEdits,
  assertReusableTemplateEditable,
  assertTemplateSimulationReady,
  cloneRuleVersionToEditableDraft,
  materializeParameterDefinitionsForPersistence,
  listReusableSettlementRuleTemplates,
  parameterDefinitionsFromUiDto,
  parameterDefinitionsToUiDto,
  type RuleParameterDefinition,
} from "./custom-rule-templates";
import { hashCustomRuleParameters } from "./custom-rule-simulation";
import { getCustomRuleSystemTemplate } from "./custom-rule-system-templates";
import type { TypedRuntimeValue } from "./custom-rule-types";

describe("custom settlement rule reuse templates", () => {
  it("clones a source version into a target-project editable draft without executable state", () => {
    const source = sourceVersionFixture();
    const cloned = cloneRuleVersionToEditableDraft({
      sourceVersion: source,
      targetProjectId: uuid(82),
      targetCatalog: targetCatalog("b".repeat(64), ["system_minutes"]),
      newVersionId: uuid(83),
      reason: "Clone into a new project draft.",
    });

    expect(cloned.version.id).toBe(uuid(83));
    expect(cloned.version.projectId).toBe(uuid(82));
    expect(cloned.version.status).toBe("draft");
    expect(cloned.version.versionNumber).toBe(1);
    expect(cloned.version.approvedBy).toBeNull();
    expect(cloned.version.approvedAt).toBeNull();
    expect(cloned.version.effectiveFrom).toBeNull();
    expect(cloned.version.effectiveUntil).toBeNull();
    expect(cloned.version.archivedAt).toBeNull();
    expect(cloned.version.aiDraftId).toBeNull();
    expect(cloned.version.simulationId).toBeNull();
    expect(cloned.version.simulationSummary).toEqual({});
    expect(cloned.version.variableCatalogVersion).toBe("b".repeat(64));
    expect(cloned.version.ruleContract.target).toEqual({
      targetType: "project",
      targetId: null,
    });
    expect(cloned.lineage).toEqual({
      sourceRuleVersionId: source.id,
      sourceProjectId: source.projectId,
      sourceVersionNumber: source.versionNumber,
      sourceScope: source.scope,
    });
  });

  it("reports missing target variables so simulation can be blocked before execution", () => {
    const cloned = cloneRuleVersionToEditableDraft({
      sourceVersion: sourceVersionFixture(),
      targetProjectId: uuid(82),
      targetCatalog: targetCatalog("b".repeat(64), ["project_id"]),
      newVersionId: uuid(83),
      reason: "Clone into a project missing the source variable.",
    });

    expect(cloned.missingTargetVariables).toEqual(["system_minutes"]);
    expect(() => assertTemplateSimulationReady(cloned)).toThrow(
      /system_minutes/u,
    );
  });

  it("applies labeled business parameter edits with persisted cents and bps", () => {
    const source = sourceVersionFixture({
      parameters: {
        hourly_rate: { type: "money_cents", amountCents: 10_000 },
        bonus_rate: { type: "rate_bps", rateBps: 2_000 },
      },
      parameterDefinitions: [
        {
          key: "hourly_rate",
          labelZh: "Hourly rate",
          type: "money_cents",
          value: 10_000,
          min: 0,
        },
        {
          key: "bonus_rate",
          labelZh: "Bonus rate",
          type: "rate_bps",
          value: 2_000,
          min: 0,
          max: 10_000,
        },
      ],
    });

    const edited = applyRuleParameterEdits({
      sourceVersion: source,
      definitions: source.parameterDefinitions,
      edits: [
        { key: "hourly_rate", type: "money_cents", value: 12_500 },
        { key: "bonus_rate", type: "rate_bps", value: 2_500 },
      ],
      newVersionId: uuid(84),
      reason: "Adjust business parameters.",
    });

    expect(edited.version.id).toBe(uuid(84));
    expect(edited.version.status).toBe("draft");
    expect(edited.version.versionNumber).toBe(source.versionNumber + 1);
    expect(edited.version.parameters).toEqual({
      hourly_rate: { type: "money_cents", amountCents: 12_500 },
      bonus_rate: { type: "rate_bps", rateBps: 2_500 },
    });
    expect(edited.version.parameterHash).toBe(
      hashCustomRuleParameters(edited.version.parameters),
    );
    expect(edited.priorSimulationStale).toBe(true);
    expect(edited.version.simulationId).toBeNull();
  });

  it("rejects parameter edits with invalid typed units or bounds", () => {
    const source = sourceVersionFixture({
      parameterDefinitions: [
        {
          key: "hourly_rate",
          labelZh: "Hourly rate",
          type: "money_cents",
          value: 10_000,
          min: 0,
        },
      ],
    });

    expect(() =>
      applyRuleParameterEdits({
        sourceVersion: source,
        definitions: source.parameterDefinitions,
        edits: [{ key: "hourly_rate", type: "rate_bps", value: 2_000 }],
        newVersionId: uuid(85),
        reason: "Wrong typed unit.",
      }),
    ).toThrow(/type/u);
    expect(() =>
      applyRuleParameterEdits({
        sourceVersion: source,
        definitions: source.parameterDefinitions,
        edits: [{ key: "hourly_rate", type: "money_cents", value: -1 }],
        newVersionId: uuid(86),
        reason: "Out of bounds.",
      }),
    ).toThrow(/minimum/u);
  });

  it("adapts persisted cents and bps to UI yuan and percent values", () => {
    const persisted: RuleParameterDefinition[] = [
      {
        key: "hourly_rate",
        labelZh: "Hourly rate",
        type: "money_cents",
        value: 12_500,
        min: 0,
        max: 100_000,
      },
      {
        key: "bonus_rate",
        labelZh: "Bonus rate",
        type: "rate_bps",
        value: 2_500,
        min: 0,
        max: 10_000,
      },
    ];

    const ui = parameterDefinitionsToUiDto(persisted);

    expect(ui).toEqual([
      expect.objectContaining({
        key: "hourly_rate",
        type: "money_yuan",
        value: 125,
        min: 0,
        max: 1_000,
      }),
      expect.objectContaining({
        key: "bonus_rate",
        type: "percent",
        value: 25,
        min: 0,
        max: 100,
      }),
    ]);
    expect(parameterDefinitionsFromUiDto(ui)).toEqual(persisted);
  });

  it("validates UI yuan and percent precision before persistence", () => {
    expect(() =>
      parameterDefinitionsFromUiDto([
        {
          key: "hourly_rate",
          labelZh: "Hourly rate",
          type: "money_yuan",
          value: 1.001,
          min: 0,
        },
      ]),
    ).toThrow(/fractional cents/u);
    expect(() =>
      parameterDefinitionsFromUiDto([
        {
          key: "bonus_rate",
          labelZh: "Bonus rate",
          type: "percent",
          value: 12.345,
          min: 0,
          max: 100,
        },
      ]),
    ).toThrow(/fractional basis points/u);
    expect(() =>
      materializeParameterDefinitionsForPersistence([
        {
          key: "bonus_rate",
          labelZh: "Bonus rate",
          type: "rate_bps",
          value: 10_001,
          min: 0,
          max: 10_000,
        },
      ]),
    ).toThrow(/maximum/u);
  });

  it("marks system templates read-only and organization templates editable", () => {
    const templates = listReusableSettlementRuleTemplates({
      systemTemplates: [
        {
          id: "system:cpt:v1",
          name: "CPT",
          description: "System template",
          contract: sourceVersionFixture().ruleContract,
        },
      ],
      organizationTemplates: [organizationTemplateFixture()],
      actorOrganizationId: ORGANIZATION_ID,
    });

    expect(templates).toEqual([
      expect.objectContaining({ id: "system:cpt:v1", readOnly: true }),
      expect.objectContaining({
        id: uuid(90),
        organizationId: ORGANIZATION_ID,
        readOnly: false,
      }),
    ]);
    expect(() =>
      assertReusableTemplateEditable({
        templateKind: "system",
        actorOrganizationId: ORGANIZATION_ID,
      }),
    ).toThrow(/read-only/u);
    expect(() =>
      assertReusableTemplateEditable({
        templateKind: "organization",
        templateOrganizationId: ORGANIZATION_ID,
        actorOrganizationId: ORGANIZATION_ID,
      }),
    ).not.toThrow();
    expect(() =>
      assertReusableTemplateEditable({
        templateKind: "organization",
        templateOrganizationId: uuid(2),
        actorOrganizationId: ORGANIZATION_ID,
      }),
    ).toThrow(/organization/u);
  });
});

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";

function sourceVersionFixture(
  overrides: Partial<{
    parameters: Record<string, TypedRuntimeValue>;
    parameterDefinitions: RuleParameterDefinition[];
  }> = {},
) {
  const parameters = overrides.parameters ?? {
    hourly_rate: { type: "money_cents" as const, amountCents: 10_000 },
  };
  return {
    id: uuid(80),
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    scope: "payable" as const,
    target: { targetType: "project" as const, targetId: null },
    executionGrain: "report" as const,
    compositionMode: "replace" as const,
    priority: 100,
    versionNumber: 3,
    status: "active" as const,
    formula: 'system_minutes * parameter("hourly_rate") / 60',
    compiledAst: { kind: "literal" as const, value: 1 },
    variables: [{ name: "system_minutes" }],
    parameters,
    parameterDefinitions:
      overrides.parameterDefinitions ??
      ([
        {
          key: "hourly_rate",
          labelZh: "Hourly rate",
          type: "money_cents",
          value: 10_000,
          min: 0,
        },
      ] satisfies RuleParameterDefinition[]),
    ruleContract: systemCptContract(),
    systemExplanationTemplate: "Pay approved minutes.",
    missingDataPolicy: { action: "route_item_to_review" },
    testCases: [],
    simulationSummary: {
      coverage: { totalRecords: 5 },
      historicalTotals: { oldPayableAmountCents: "10000" },
      sampleSelection: { periodStart: "2026-07-01" },
    },
    formulaHash: "c".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: hashCustomRuleParameters(parameters),
    catalogHash: "a".repeat(64),
    dataSelectionHash: "e".repeat(64),
    variableCatalogVersion: "a".repeat(64),
    simulationId: uuid(81),
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: uuid(1),
    approvedBy: uuid(2),
    aiDraftId: uuid(3),
    reason: "Approved source rule.",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    archivedAt: null,
  };
}

function targetCatalog(version: string, variables: string[]) {
  return {
    version,
    variables: variables.map((id) => ({
      id,
      availability: "available" as const,
    })),
  };
}

function organizationTemplateFixture() {
  const source = sourceVersionFixture();
  return {
    id: uuid(90),
    organizationId: ORGANIZATION_ID,
    name: "Org CPT",
    description: null,
    sourceRuleVersionId: source.id,
    sourceProjectId: source.projectId,
    sourceVersionNumber: source.versionNumber,
    sourceScope: source.scope,
    executionGrain: source.executionGrain,
    compositionMode: source.compositionMode,
    formula: source.formula,
    compiledAst: source.compiledAst,
    variables: source.variables,
    parameters: source.parameters,
    ruleContract: source.ruleContract,
    missingDataPolicy: source.missingDataPolicy,
    testCases: source.testCases,
    status: "active" as const,
    createdBy: uuid(1),
    createdAt: "2026-07-13T00:00:00.000Z",
    archivedAt: null,
  };
}

function systemCptContract() {
  const template = getCustomRuleSystemTemplate("system:cpt:v1");
  if (!template) throw new Error("system CPT template fixture is missing");
  return template.contract;
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
}
