import { z } from "zod";

import {
  CUSTOM_RULE_COMPOSITION_MODES,
  CUSTOM_RULE_EXECUTION_GRAINS,
  CUSTOM_RULE_SCOPES,
  CUSTOM_RULE_TARGET_TYPES,
  CUSTOM_RULE_VERSION_STATUSES,
  RUNTIME_SCALAR_TYPES,
  isCustomRuleTargetCompatible,
  serializePostgresBigintCents,
} from "./custom-rule-types";
import type {
  CustomRuleMissingDataPolicy,
  CustomRuleTarget,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";

export const customRuleScopeSchema = z.enum(CUSTOM_RULE_SCOPES);
export const customRuleTargetTypeSchema = z.enum(CUSTOM_RULE_TARGET_TYPES);
export const customRuleExecutionGrainSchema = z.enum(
  CUSTOM_RULE_EXECUTION_GRAINS,
);
export const customRuleCompositionModeSchema = z.enum(
  CUSTOM_RULE_COMPOSITION_MODES,
);
export const customRuleVersionStatusSchema = z.enum(
  CUSTOM_RULE_VERSION_STATUSES,
);
export const runtimeScalarTypeSchema = z.enum(RUNTIME_SCALAR_TYPES);

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .refine((value) => value !== "amount", {
    message: "use an explicit unit-bearing identifier instead of amount",
  });
const nonEmptyTextSchema = z.string().trim().min(1);
const chineseTextSchema = z
  .string()
  .trim()
  .min(2)
  .refine((value) => /[\u3400-\u9fff]/.test(value), {
    message: "must contain Chinese text",
  });
const finiteNumberSchema = z.number().refine(Number.isFinite, {
  message: "must be finite",
});
const safeIntegerSchema = z.number().refine(Number.isSafeInteger, {
  message: "must be a safe integer",
});
const nonnegativeSafeIntegerSchema = z
  .number()
  .refine((value) => Number.isSafeInteger(value) && value >= 0, {
    message: "must be a nonnegative safe integer",
  });
const offsetDateTimeSchema = z.iso.datetime({ offset: true });
const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isValidIanaTimezone, { message: "must be a valid IANA timezone" });

export const customRuleTargetSchema: z.ZodType<CustomRuleTarget> =
  z.discriminatedUnion("targetType", [
    z.strictObject({
      targetType: z.literal("project"),
      targetId: z.null(),
    }),
    z.strictObject({
      targetType: z.literal("streamer_group"),
      targetId: z.string().trim().min(1),
    }),
    z.strictObject({
      targetType: z.literal("project_streamer"),
      targetId: z.string().trim().min(1),
    }),
  ]);

export const runtimeValueTypeSchema: z.ZodType<RuntimeValueType> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("scalar"),
      scalarType: runtimeScalarTypeSchema,
    }),
    z.strictObject({
      kind: z.literal("array"),
      itemType: runtimeValueTypeSchema,
    }),
    z.strictObject({
      kind: z.literal("object"),
      fields: z
        .record(identifierSchema, runtimeValueTypeSchema)
        .refine((fields) => !("amount" in fields), {
          message: "use an explicit unit-bearing field name instead of amount",
        }),
    }),
  ]),
);

export const typedRuntimeValueSchema: z.ZodType<TypedRuntimeValue> = z.lazy(
  () =>
    z.discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("money_cents"),
        amountCents: safeIntegerSchema,
      }),
      z.strictObject({
        type: z.literal("rate_bps"),
        rateBps: safeIntegerSchema,
      }),
      z.strictObject({
        type: z.literal("number"),
        value: finiteNumberSchema,
      }),
      z.strictObject({
        type: z.literal("integer"),
        value: safeIntegerSchema,
      }),
      z.strictObject({
        type: z.literal("boolean"),
        value: z.boolean(),
      }),
      z.strictObject({
        type: z.literal("string"),
        value: z.string(),
      }),
      z.strictObject({
        type: z.literal("timestamp"),
        value: offsetDateTimeSchema,
      }),
      z.strictObject({
        type: z.literal("array"),
        items: z.array(typedRuntimeValueSchema),
      }),
      z.strictObject({
        type: z.literal("object"),
        fields: z
          .record(identifierSchema, typedRuntimeValueSchema)
          .refine((fields) => !("amount" in fields), {
            message:
              "use an explicit unit-bearing field name instead of amount",
          }),
      }),
    ]),
);

export const customRuleMissingDataPolicySchema: z.ZodType<CustomRuleMissingDataPolicy> =
  z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("route_item_to_review") }),
    z.strictObject({ action: z.literal("block_batch") }),
    z.strictObject({
      action: z.literal("use_explicit_default"),
      defaultValue: typedRuntimeValueSchema,
    }),
  ]);

export const customRuleParameterDefinitionSchema = z
  .strictObject({
    name: identifierSchema,
    description: nonEmptyTextSchema,
    valueType: runtimeValueTypeSchema,
    userFacingUnit: nonEmptyTextSchema,
    defaultValue: typedRuntimeValueSchema,
  })
  .superRefine((parameter, context) => {
    if (!runtimeValueMatchesType(parameter.defaultValue, parameter.valueType)) {
      context.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "defaultValue must match valueType",
      });
    }
  });

const canonicalPostgresBigintCentsSchema = z.string().refine(
  (value) => {
    try {
      return serializePostgresBigintCents(value) === value;
    } catch {
      return false;
    }
  },
  { message: "must be a canonical Postgres bigint decimal string" },
);

export const customRuleSimulationSummarySchema = z
  .strictObject({
    totalRecords: nonnegativeSafeIntegerSchema,
    calculatedRecords: nonnegativeSafeIntegerSchema,
    routedToReviewRecords: nonnegativeSafeIntegerSchema,
    blockedRecords: nonnegativeSafeIntegerSchema,
    aggregateAmountCents: canonicalPostgresBigintCentsSchema.nullable(),
  })
  .superRefine((summary, context) => {
    if (
      summary.calculatedRecords +
        summary.routedToReviewRecords +
        summary.blockedRecords !==
      summary.totalRecords
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalRecords"],
        message: "status counts must equal totalRecords",
      });
    }
  });

export const customRuleSimulationRecordSchema = z.strictObject({
  recordId: nonEmptyTextSchema,
  status: z.enum(["calculated", "routed_to_review", "blocked"]),
  inputValues: z.record(identifierSchema, typedRuntimeValueSchema),
  result: typedRuntimeValueSchema.nullable(),
  diagnostics: z.array(nonEmptyTextSchema),
});

const calculationComponentSchema = z.strictObject({
  name: identifierSchema,
  description: nonEmptyTextSchema,
  expression: nonEmptyTextSchema,
  resultType: runtimeValueTypeSchema,
});

const requiredInputSchema = z.strictObject({
  name: identifierSchema,
  description: nonEmptyTextSchema,
  source: nonEmptyTextSchema,
  valueType: runtimeValueTypeSchema,
  userFacingUnit: nonEmptyTextSchema,
});

const businessRuleExampleSchema = z.strictObject({
  name: nonEmptyTextSchema,
  kind: z.enum(["normal", "boundary"]),
  description: nonEmptyTextSchema,
  inputs: z.record(identifierSchema, typedRuntimeValueSchema),
  expectedResult: typedRuntimeValueSchema,
});

const businessRuleContractShape = {
  schemaVersion: z.literal(1).default(1),
  scope: customRuleScopeSchema,
  target: customRuleTargetSchema,
  executionGrain: customRuleExecutionGrainSchema,
  compositionMode: customRuleCompositionModeSchema,
  title: chineseTextSchema,
  summary: chineseTextSchema,
  calculationComponents: z.array(calculationComponentSchema).min(1),
  requiredInputs: z.array(requiredInputSchema).min(1),
  parameters: z.array(customRuleParameterDefinitionSchema).min(1),
  effectiveStartAt: offsetDateTimeSchema,
  effectiveEndAt: offsetDateTimeSchema.nullable(),
  missingDataPolicy: customRuleMissingDataPolicySchema,
  compositionDescription: nonEmptyTextSchema,
  businessTimezone: ianaTimezoneSchema.default("Asia/Shanghai"),
  examples: z.array(businessRuleExampleSchema).min(3),
};

export const businessRuleContractSchema = z
  .strictObject(businessRuleContractShape)
  .superRefine((contract, context) => {
    if (
      !isCustomRuleTargetCompatible(
        contract.scope,
        contract.target.targetType,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["target", "targetType"],
        message: "target type is not supported for this scope",
      });
    }

    if (
      contract.effectiveEndAt !== null &&
      Date.parse(contract.effectiveEndAt) <= Date.parse(contract.effectiveStartAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveEndAt"],
        message: "effectiveEndAt must be later than effectiveStartAt",
      });
    }

    const normalExamples = contract.examples.filter(
      (example) => example.kind === "normal",
    ).length;
    const boundaryExamples = contract.examples.filter(
      (example) => example.kind === "boundary",
    ).length;
    if (normalExamples < 1) {
      context.addIssue({
        code: "custom",
        path: ["examples"],
        message: "at least one normal example is required",
      });
    }
    if (boundaryExamples < 2) {
      context.addIssue({
        code: "custom",
        path: ["examples"],
        message: "at least two boundary examples are required",
      });
    }

    addDuplicateNameIssue(
      contract.calculationComponents,
      "calculationComponents",
      context,
    );
    addDuplicateNameIssue(contract.requiredInputs, "requiredInputs", context);
    addDuplicateNameIssue(contract.parameters, "parameters", context);
    addDuplicateNameIssue(contract.examples, "examples", context);
  });

export const businessRuleContractPatchSchema = z.strictObject({
  scope: customRuleScopeSchema.optional(),
  target: customRuleTargetSchema.optional(),
  executionGrain: customRuleExecutionGrainSchema.optional(),
  compositionMode: customRuleCompositionModeSchema.optional(),
  title: chineseTextSchema.optional(),
  summary: chineseTextSchema.optional(),
  calculationComponents: z.array(calculationComponentSchema).min(1).optional(),
  requiredInputs: z.array(requiredInputSchema).min(1).optional(),
  parameters: z
    .array(customRuleParameterDefinitionSchema)
    .min(1)
    .optional(),
  effectiveStartAt: offsetDateTimeSchema.optional(),
  effectiveEndAt: offsetDateTimeSchema.nullable().optional(),
  missingDataPolicy: customRuleMissingDataPolicySchema.optional(),
  compositionDescription: nonEmptyTextSchema.optional(),
  businessTimezone: ianaTimezoneSchema.optional(),
  examples: z.array(businessRuleExampleSchema).min(3).optional(),
});

export type CustomRuleParameterDefinition = z.infer<
  typeof customRuleParameterDefinitionSchema
>;
export type CustomRuleSimulationSummary = z.infer<
  typeof customRuleSimulationSummarySchema
>;
export type CustomRuleSimulationRecord = z.infer<
  typeof customRuleSimulationRecordSchema
>;
export type BusinessRuleContract = z.infer<typeof businessRuleContractSchema>;
export type BusinessRuleContractPatch = z.infer<
  typeof businessRuleContractPatchSchema
>;
export type BusinessRuleContractChange = {
  field: keyof BusinessRuleContract;
  before: BusinessRuleContract[keyof BusinessRuleContract];
  after: BusinessRuleContract[keyof BusinessRuleContract];
};

const BUSINESS_RULE_CONTRACT_FIELD_ORDER = [
  "schemaVersion",
  "scope",
  "target",
  "executionGrain",
  "compositionMode",
  "title",
  "summary",
  "calculationComponents",
  "requiredInputs",
  "parameters",
  "effectiveStartAt",
  "effectiveEndAt",
  "missingDataPolicy",
  "compositionDescription",
  "businessTimezone",
  "examples",
] as const satisfies readonly (keyof BusinessRuleContract)[];

export function reviseBusinessRuleContract(
  before: BusinessRuleContract,
  patch: BusinessRuleContractPatch,
): BusinessRuleContract {
  const parsedBefore = businessRuleContractSchema.parse(before);
  const parsedPatch = businessRuleContractPatchSchema.parse(patch);

  return businessRuleContractSchema.parse({
    ...parsedBefore,
    ...parsedPatch,
  });
}

export function diffBusinessRuleContracts(
  before: BusinessRuleContract,
  after: BusinessRuleContract,
): BusinessRuleContractChange[] {
  const parsedBefore = businessRuleContractSchema.parse(before);
  const parsedAfter = businessRuleContractSchema.parse(after);

  return BUSINESS_RULE_CONTRACT_FIELD_ORDER.flatMap((field) => {
    const beforeValue = parsedBefore[field];
    const afterValue = parsedAfter[field];
    if (stableJson(beforeValue) === stableJson(afterValue)) {
      return [];
    }
    return [{ field, before: beforeValue, after: afterValue }];
  });
}

function runtimeValueMatchesType(
  value: TypedRuntimeValue,
  valueType: RuntimeValueType,
): boolean {
  if (valueType.kind === "scalar") {
    return value.type === valueType.scalarType;
  }
  if (valueType.kind === "array") {
    return (
      value.type === "array" &&
      value.items.every((item) =>
        runtimeValueMatchesType(item, valueType.itemType),
      )
    );
  }
  if (value.type !== "object") {
    return false;
  }

  const expectedKeys = Object.keys(valueType.fields).sort();
  const actualKeys = Object.keys(value.fields).sort();
  return (
    stableJson(expectedKeys) === stableJson(actualKeys) &&
    expectedKeys.every((key) =>
      runtimeValueMatchesType(value.fields[key], valueType.fields[key]),
    )
  );
}

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function addDuplicateNameIssue(
  items: ReadonlyArray<{ name: string }>,
  path: string,
  context: z.RefinementCtx,
): void {
  const names = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (names.has(item.name)) {
      context.addIssue({
        code: "custom",
        path: [path, index, "name"],
        message: "name must be unique",
      });
    }
    names.add(item.name);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
