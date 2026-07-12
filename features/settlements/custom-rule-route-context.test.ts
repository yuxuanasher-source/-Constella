import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { businessRuleContractSchema } from "./custom-rule-contract";
import { buildCustomRuleTemplateExplanation } from "./custom-rule-explanation";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import {
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
} from "./custom-rule-simulation";
import { getCustomRuleSystemTemplate } from "./custom-rule-system-templates";
import { validateCustomRuleFormula } from "./custom-rule-validator";

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
  getAuthContext: vi.fn(),
  createConversationPersistence: vi.fn(),
  createConversationService: vi.fn(),
  repositoryConstructor: vi.fn(),
  createProviders: vi.fn(),
  resolveRouting: vi.fn(),
  runGateway: vi.fn(),
  createAiAdapter: vi.fn(),
  createAuthoringService: vi.fn(),
  buildCatalog: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("./custom-rule-feature-flag", () => ({
  isCustomSettlementRulesEnabled: mocks.isEnabled,
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
  createSupabaseAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: mocks.getAuthContext,
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/features/ai/conversation-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/ai/conversation-service")>();
  return {
    ...actual,
    createSupabaseConversationPersistence: mocks.createConversationPersistence,
    createConversationService: mocks.createConversationService,
  };
});

vi.mock("@/features/ai/provider-registry", () => ({
  createConfiguredAiProviders: mocks.createProviders,
  resolveAiProviderRouting: mocks.resolveRouting,
}));

vi.mock("@/features/ai/llm-gateway", () => ({
  runAiGateway: mocks.runGateway,
}));

vi.mock("./custom-rule-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./custom-rule-ai")>();
  return { ...actual, createSettlementRuleAiAdapter: mocks.createAiAdapter };
});

vi.mock("./custom-rule-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./custom-rule-service")>();
  return {
    ...actual,
    createCustomRuleAuthoringService: mocks.createAuthoringService,
  };
});

vi.mock("./custom-rule-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./custom-rule-repository")>();
  return {
    ...actual,
    SupabaseCustomRuleReadRepository: class {
      constructor(client: unknown) {
        return mocks.repositoryConstructor(client);
      }
    },
  };
});

vi.mock("./custom-rule-variable-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./custom-rule-variable-catalog")>();
  return { ...actual, buildCustomRuleVariableCatalog: mocks.buildCatalog };
});

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function auth(role: "owner" | "streamer" = "owner") {
  return {
    userId: USER_ID,
    email: "owner@example.com",
    name: "Owner",
    organizationId: ORGANIZATION_ID,
    organizationName: "Org",
    role,
  };
}

function projectQuery(project: { id: string } | null = { id: PROJECT_ID }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: project, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("custom rule route context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled.mockReturnValue(true);

    const query = projectQuery();
    const supabase = { from: vi.fn().mockReturnValue(query) };
    const admin = { from: vi.fn(), rpc: vi.fn() };
    const repository = {
      getProjectVariableCoverage: vi.fn().mockResolvedValue({}),
      listDrafts: vi.fn(),
      getDraft: vi.fn(),
      listSimulations: vi.fn(),
      insertSimulation: vi.fn(),
    };
    const conversationPersistence = { kind: "conversation-persistence" };
    const conversation = { kind: "conversation-service" };
    const ai = { kind: "settlement-ai" };

    mocks.createServerClient.mockResolvedValue(supabase);
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.getAuthContext.mockResolvedValue(auth());
    mocks.createConversationPersistence.mockReturnValue(
      conversationPersistence,
    );
    mocks.createConversationService.mockImplementation(() => ({
      ...conversation,
      instance: Symbol("conversation"),
    }));
    mocks.repositoryConstructor.mockReturnValue(repository);
    mocks.createProviders.mockReturnValue([
      { name: "deterministic", capabilities: ["structured"] },
    ]);
    mocks.resolveRouting.mockReturnValue({
      primaryProvider: "deterministic",
    });
    mocks.createAiAdapter.mockReturnValue(ai);
    mocks.createAuthoringService.mockImplementation(() => ({
      instance: Symbol("authoring"),
    }));
    mocks.buildCatalog.mockReturnValue({
      scope: "payable",
      executionGrain: "report",
      version: "a".repeat(64),
      variables: [],
    });
  });

  it("fails closed while the feature flag is disabled", async () => {
    mocks.isEnabled.mockReturnValue(false);
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const response = await getCustomRuleRouteContext();

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected response");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_FEATURE_DISABLED",
        message: "Custom settlement rule authoring is disabled",
        retryable: false,
      },
    });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("returns a safe unauthenticated response", async () => {
    mocks.createServerClient.mockResolvedValue(null);
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const response = await getCustomRuleRouteContext();

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected response");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        retryable: false,
      },
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects streamers before creating privileged dependencies", async () => {
    mocks.getAuthContext.mockResolvedValue(auth("streamer"));
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const response = await getCustomRuleRouteContext();

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected response");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_FORBIDDEN",
        message: "Settlement rule authoring is limited to MCN staff",
        retryable: false,
      },
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails safely when generic conversation storage is unavailable", async () => {
    mocks.createAdminClient.mockReturnValue(null);
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const response = await getCustomRuleRouteContext();

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected response");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
        message: "Settlement rule authoring storage is unavailable",
        retryable: true,
      },
    });
  });

  it("composes fresh scoped services without a mutable singleton", async () => {
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const first = await getCustomRuleRouteContext();
    const second = await getCustomRuleRouteContext();

    expect(first).not.toBeInstanceOf(Response);
    expect(second).not.toBeInstanceOf(Response);
    if (first instanceof Response || second instanceof Response) {
      throw new Error("Expected route contexts");
    }
    expect(first.authoring).not.toBe(second.authoring);
    expect(first.conversation).not.toBe(second.conversation);
    expect(mocks.repositoryConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.createConversationPersistence).toHaveBeenCalledTimes(2);
    expect(mocks.createConversationService).toHaveBeenCalledTimes(2);
    expect(mocks.createProviders).toHaveBeenCalledTimes(2);
    expect(mocks.createAuthoringService).toHaveBeenCalledTimes(2);
    expect(mocks.createAuthoringService).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation: second.conversation,
        repository: second.repository,
        catalog: second.catalog,
        evidence: second.evidence,
        analyzeReadiness: expect.any(Function),
        simulate: expect.any(Function),
        ai: expect.any(Object),
        primaryProvider: "deterministic",
        persistFailedRevisions: true,
      }),
    );
  });

  it("builds catalogs from organization and project scoped coverage", async () => {
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) throw new Error("Expected route context");

    await context.catalog.getCatalog({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scope: "payable",
      executionGrain: "report",
    });

    expect(context.repository.getProjectVariableCoverage).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    });
    expect(mocks.buildCatalog).toHaveBeenCalledWith({
      scope: "payable",
      executionGrain: "report",
      coverage: {},
    });
  });

  it("checks project access with both project and organization predicates", async () => {
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) throw new Error("Expected route context");

    await context.requireProjectAccess(PROJECT_ID);

    const supabase = await mocks.createServerClient.mock.results[0]?.value;
    const query = supabase.from.mock.results[0]?.value;
    expect(query.eq).toHaveBeenCalledWith("id", PROJECT_ID);
    expect(query.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
  });

  it("hides cross-organization projects behind a stable not-found error", async () => {
    const query = projectQuery(null);
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn().mockReturnValue(query),
    });
    const { customRuleErrorResponse, getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) throw new Error("Expected route context");

    let caught: unknown;
    try {
      await context.requireProjectAccess(PROJECT_ID);
    } catch (error) {
      caught = error;
    }
    const response = customRuleErrorResponse(caught);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        message: "Project not found",
        retryable: false,
      },
    });
  });

  it("uses Zod for malformed and invalid JSON bodies", async () => {
    const { customRuleErrorResponse, parseCustomRuleJson } =
      await import("./custom-rule-route-context");
    const schema = z.strictObject({ promptText: z.string().min(1) });

    for (const [request, expected] of [
      [
        new Request("http://localhost", { method: "POST", body: "{" }),
        {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON",
          retryable: false,
        },
      ],
      [
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ promptText: 42 }),
        }),
        {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
          path: ["promptText"],
          retryable: false,
        },
      ],
    ] as const) {
      let caught: unknown;
      try {
        await parseCustomRuleJson(request, schema);
      } catch (error) {
        caught = error;
      }
      const response = customRuleErrorResponse(caught);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expected });
    }
  });

  it("maps stale revisions and unknown failures without leaking secrets", async () => {
    const { CustomRuleRouteError, customRuleErrorResponse } =
      await import("./custom-rule-route-context");

    const stale = customRuleErrorResponse(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_STALE_REVISION",
        message: "Settlement rule draft is stale",
        status: 409,
        retryable: false,
      }),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_STALE_REVISION",
        message: "Settlement rule draft is stale",
        retryable: false,
      },
    });

    const secret = customRuleErrorResponse(
      new Error("sk-live-secret raw prompt model stack"),
    );
    expect(secret.status).toBe(500);
    const body = await secret.json();
    expect(body).toEqual({
      error: {
        code: "CUSTOM_RULE_INTERNAL_ERROR",
        message: "Unable to process settlement rule request",
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("sk-live-secret");
    expect(JSON.stringify(body)).not.toContain("raw prompt");
  });
});

type QueryChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  returns: ReturnType<typeof vi.fn>;
};

type TableQueryMock = QueryChain & { createQuery(): QueryChain };

function tableQuery(
  fixtureData: unknown[] | unknown[][],
  options: { error?: unknown; enforceFilters?: boolean } = {},
): TableQueryMock {
  const rows = (
    Array.isArray(fixtureData[0])
      ? (fixtureData as unknown[][]).flat()
      : fixtureData
  ).filter((row) => row !== undefined);
  const tracker = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    gt: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    lt: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    returns: vi.fn(),
  } as QueryChain;

  const createQuery = (): QueryChain => {
    const filters: Array<(row: unknown) => boolean> = [];
    let selectedColumns: string | null = null;
    let orderedColumn: string | null = null;
    let ascending = true;
    let maximumRows: number | null = null;
    let selectedRange: { from: number; to: number } | null = null;
    let exactCount = false;
    const query = {} as QueryChain;
    const filter = (
      spy: ReturnType<typeof vi.fn>,
      column: string,
      predicate: (value: unknown) => boolean,
      args: unknown[],
    ) => {
      recordMockCall(spy, column, ...args);
      if (options.enforceFilters !== false) {
        filters.push((row) => valuesAtPath(row, column).some(predicate));
      }
      return query;
    };

    query.select = vi.fn(
      (columns: string, selectOptions?: { count?: string }) => {
        recordMockCall(tracker.select, columns, selectOptions);
        selectedColumns = columns;
        exactCount = selectOptions?.count === "exact";
        return query;
      },
    );
    query.eq = vi.fn((column: string, value: unknown) =>
      filter(tracker.eq, column, (candidate) => candidate === value, [value]),
    );
    query.neq = vi.fn((column: string, value: unknown) =>
      filter(tracker.neq, column, (candidate) => candidate !== value, [value]),
    );
    query.gt = vi.fn((column: string, value: unknown) =>
      filter(
        tracker.gt,
        column,
        (candidate) => compareValues(candidate, value) > 0,
        [value],
      ),
    );
    query.gte = vi.fn((column: string, value: unknown) =>
      filter(
        tracker.gte,
        column,
        (candidate) => compareValues(candidate, value) >= 0,
        [value],
      ),
    );
    query.lte = vi.fn((column: string, value: unknown) =>
      filter(
        tracker.lte,
        column,
        (candidate) => compareValues(candidate, value) <= 0,
        [value],
      ),
    );
    query.lt = vi.fn((column: string, value: unknown) =>
      filter(
        tracker.lt,
        column,
        (candidate) => compareValues(candidate, value) < 0,
        [value],
      ),
    );
    query.in = vi.fn((column: string, values: unknown[]) => {
      const allowed = new Set(values);
      return filter(tracker.in, column, (candidate) => allowed.has(candidate), [
        values,
      ]);
    });
    query.not = vi.fn((column: string, operator: string, value: unknown) => {
      recordMockCall(tracker.not, column, operator, value);
      if (options.enforceFilters !== false) {
        filters.push((row) => {
          const candidates = valuesAtPath(row, column);
          if (operator === "is" && value === null) {
            return candidates.some((candidate) => candidate !== null);
          }
          return candidates.every((candidate) => candidate !== value);
        });
      }
      return query;
    });
    query.order = vi.fn(
      (column: string, orderOptions?: { ascending?: boolean }) => {
        recordMockCall(tracker.order, column, orderOptions);
        orderedColumn = column;
        ascending = orderOptions?.ascending !== false;
        return query;
      },
    );
    query.limit = vi.fn((value: number) => {
      recordMockCall(tracker.limit, value);
      maximumRows = value;
      return query;
    });
    query.range = vi.fn((from: number, to: number) => {
      recordMockCall(tracker.range, from, to);
      selectedRange = { from, to };
      return query;
    });
    query.returns = vi.fn(async () => {
      recordMockCall(tracker.returns);
      if (options.error) {
        return { data: null, error: options.error, count: null };
      }
      let selected = rows.filter((row) =>
        filters.every((predicate) => predicate(row)),
      );
      const count = selected.length;
      if (orderedColumn) {
        selected = [...selected].sort((left, right) => {
          const comparison = compareValues(
            valuesAtPath(left, orderedColumn ?? "")[0],
            valuesAtPath(right, orderedColumn ?? "")[0],
          );
          return ascending ? comparison : -comparison;
        });
      }
      if (selectedRange) {
        selected = selected.slice(selectedRange.from, selectedRange.to + 1);
      }
      if (maximumRows !== null) selected = selected.slice(0, maximumRows);
      return {
        data: selectedColumns
          ? selected.map((row) =>
              projectSelectedRow(row, selectedColumns ?? ""),
            )
          : selected,
        error: null,
        count: exactCount ? count : null,
      };
    });
    return query;
  };

  return Object.assign(tracker, { createQuery });
}

function recordMockCall(
  mock: ReturnType<typeof vi.fn>,
  ...args: unknown[]
): void {
  (mock as unknown as (...values: unknown[]) => unknown)(...args);
}

function valuesAtPath(row: unknown, path: string): unknown[] {
  let values = [row];
  for (const segment of path.split(".")) {
    values = values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== "object") return [];
      const next = Reflect.get(value, segment);
      return Array.isArray(next) ? next : [next];
    });
  }
  return values;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (
    typeof left === "string" &&
    typeof right === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(left) &&
    /^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(right)
  ) {
    return Date.parse(left) - Date.parse(right);
  }
  return String(left).localeCompare(String(right));
}

function projectSelectedRow(row: unknown, columns: string): unknown {
  if (!row || typeof row !== "object") return row;
  const projected: Record<string, unknown> = {};
  for (const token of splitSelectedColumns(columns)) {
    const key = token.split("!", 1)[0]?.split("(", 1)[0]?.trim();
    if (key && Object.prototype.hasOwnProperty.call(row, key)) {
      const value = Reflect.get(row, key);
      const opening = token.indexOf("(");
      const nestedColumns =
        opening >= 0 && token.endsWith(")")
          ? token.slice(opening + 1, -1)
          : null;
      projected[key] = nestedColumns
        ? Array.isArray(value)
          ? value.map((item) => projectSelectedRow(item, nestedColumns))
          : projectSelectedRow(value, nestedColumns)
        : value;
    }
  }
  return projected;
}

function splitSelectedColumns(columns: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let depth = 0;
  for (const [index, character] of [...columns].entries()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      tokens.push(columns.slice(start, index).trim());
      start = index + 1;
    }
  }
  tokens.push(columns.slice(start).trim());
  return tokens.filter(Boolean);
}

function evidenceDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: "44444444-4444-4444-8444-444444444444",
    revisionNumber: 3,
    createdBy: USER_ID,
    status: "contract_ready",
    initialStatus: "contract_ready",
    businessContract: {
      scope: "payable",
      executionGrain: "report",
      businessTimezone: "Asia/Shanghai",
      requiredInputs: [{ name: "system_minutes" }],
    },
    ...overrides,
  };
}

function approvedReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    streamer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "approved",
    system_duration: 60,
    screenshot_duration: 59,
    settlement_duration: 60,
    evidence_level: "green",
    time_source: "system",
    viewers: 120,
    reviewed_at: "2026-07-05T08:00:00.000Z",
    created_at: "2026-07-05T07:00:00.000Z",
    settled_batch_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    live_tasks: { system_started_at: "2026-07-05T06:00:00.000Z" },
    ...overrides,
  };
}

function lockedSettlementBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    status: "locked",
    batch_type: "payable",
    locked_at: "2026-07-10T00:00:00.000Z",
    period_start: "2026-07-01",
    period_end: "2026-07-10",
    ...overrides,
  };
}

function lockedSettlementItem(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    settlement_batch_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    streamer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    live_report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    computed_amount: "10.00",
    manual_amount: "2.00",
    adjustment_amount: "0.50",
    settlement_batches: lockedSettlementBatch(),
    ...overrides,
  };
  const unsafeRelation = row.settlement_batches;
  const normalizedRelations = (
    Array.isArray(unsafeRelation) ? unsafeRelation : [unsafeRelation]
  ).map((relation) => ({
    ...lockedSettlementBatch(),
    ...(relation && typeof relation === "object" ? relation : {}),
  }));
  row.settlement_batches = Array.isArray(unsafeRelation)
    ? normalizedRelations
    : normalizedRelations[0];
  if (!Object.prototype.hasOwnProperty.call(overrides, "settlement_batch_id")) {
    row.settlement_batch_id = normalizedRelations[0]?.id ?? null;
  }
  return row;
}

function confirmedCostItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "75757575-7575-4757-8757-757575757575",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    live_report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    settlement_batch_id: null,
    amount_cents: "200",
    direction: "cost",
    status: "confirmed",
    created_at: "2026-07-05T08:00:00.000Z",
    ...overrides,
  };
}

function joinedStreamer(overrides: Record<string, unknown> = {}) {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    streamer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    hourly_rate: "100.00",
    base_salary: "1000.00",
    cps_rate_bps: 2000,
    collaboration_id: null,
    streamers: { source_type: "external" },
    ...overrides,
  };
}

function selection() {
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-10",
    criteriaCodes: [
      "approved_reports",
      "period_overlap",
      "complete_evidence",
      "project_scope",
    ] as const,
    userExamples: [],
  };
}

function fixtureUuid(index: number, family = "1") {
  return `${family.repeat(8)}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function evidenceHarness(input?: {
  reports?: unknown[];
  items?: unknown[];
  pairedItems?: unknown[];
  batches?: unknown[];
  costs?: unknown[];
  streamers?: unknown[];
  draft?: unknown;
  enforceFilters?: boolean;
  catalog?: unknown;
}) {
  const itemRows = [
    ...flattenFixtureRows(input?.items ?? [lockedSettlementItem()]),
    ...flattenFixtureRows(input?.pairedItems ?? []),
  ];
  const batchRows =
    input?.batches ?? deriveSettlementBatchesFromItems(itemRows);
  const queryOptions = { enforceFilters: input?.enforceFilters };
  const reports = tableQuery(
    input?.reports ?? [approvedReport()],
    queryOptions,
  );
  const items = tableQuery(itemRows, queryOptions);
  const batches = tableQuery(batchRows, queryOptions);
  const costs = tableQuery(input?.costs ?? [], queryOptions);
  const streamers = tableQuery(
    input?.streamers ?? [joinedStreamer()],
    queryOptions,
  );
  const client = {
    from: vi.fn((table: string) => {
      if (table === "live_reports") return reports.createQuery();
      if (table === "settlement_batches") return batches.createQuery();
      if (table === "settlement_batch_items") return items.createQuery();
      if (table === "project_cost_items") return costs.createQuery();
      if (table === "project_streamers") return streamers.createQuery();
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  const repository = {
    listDrafts: vi.fn().mockResolvedValue([input?.draft ?? evidenceDraft()]),
    insertSimulation: vi.fn().mockImplementation(async (simulation) => ({
      id: "78787878-7878-4787-8787-787878787878",
      createdAt: "2026-07-12T06:00:00.000Z",
      duplicate: false,
      ...simulation,
    })),
  };
  const routeModule = await import("./custom-rule-route-context");
  const createAdapter = (
    routeModule as typeof routeModule & {
      createSupabaseCustomRuleEvidenceAdapter: (input: {
        client: unknown;
        repository: unknown;
        catalog: unknown;
      }) => {
        authorizeSelection(input: Record<string, unknown>): Promise<{
          selectionToken: string;
          periodStart: string;
          periodEnd: string;
          criteriaCodes: readonly (
            | "approved_reports"
            | "period_overlap"
            | "complete_evidence"
            | "project_scope"
          )[];
        }>;
        loadAuthorizedEvidence(input: Record<string, unknown>): Promise<{
          provenance: {
            selectionToken: string;
            evidenceHash: string;
            immutableSourceVersions: Array<{
              source: string;
              version: string;
            }>;
          };
          sampleSource: { kind: string };
          sampleSelection: { populationCount: number };
          currentMarginCents?: string | null;
          userExamples: Array<{
            id: string;
            inputs: Record<string, unknown>;
            expectedResult: unknown;
          }>;
          records: Array<{
            recordId: string;
            sourceVersion: { version: string };
            variables: Record<string, unknown>;
            currentRuleResult: unknown;
          }>;
        }>;
      };
    }
  ).createSupabaseCustomRuleEvidenceAdapter;
  const catalog = input?.catalog ?? {
    getCatalog: vi.fn().mockResolvedValue({
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "confirmed_contract",
      variables: [],
    }),
  };
  const adapter = createAdapter({ client, repository, catalog });
  return {
    adapter,
    client,
    repository,
    catalog,
    reports,
    batches,
    items,
    costs,
    streamers,
  };
}

function flattenFixtureRows(rows: unknown[] | unknown[][]): unknown[] {
  return Array.isArray(rows[0]) ? (rows as unknown[][]).flat() : rows;
}

function deriveSettlementBatchesFromItems(items: unknown[]): unknown[] {
  const rowsById = new Map<string, unknown>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const unsafeRelation = Reflect.get(item, "settlement_batches");
    const relation = Array.isArray(unsafeRelation)
      ? unsafeRelation[0]
      : unsafeRelation;
    if (!relation || typeof relation !== "object") continue;
    const id = Reflect.get(relation, "id");
    if (typeof id !== "string") continue;
    rowsById.set(id, {
      organization_id: Reflect.get(item, "organization_id"),
      project_id: Reflect.get(item, "project_id"),
      ...relation,
      period_start: Reflect.get(relation, "period_start") ?? "2026-07-01",
      period_end: Reflect.get(relation, "period_end") ?? "2026-07-10",
    });
  }
  return [...rowsById.values()];
}

function authorizationInput(
  selectionInput: Record<string, unknown> = selection(),
) {
  return {
    actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
    projectId: PROJECT_ID,
    conversationId: "44444444-4444-4444-8444-444444444444",
    draftId: "55555555-5555-4555-8555-555555555555",
    expectedRevisionNumber: 3,
    selection: selectionInput,
  };
}

describe("Supabase custom-rule authorized evidence adapter", () => {
  it("uses confirmed Asia/Shanghai midnight boundaries for approved-operation fallback", async () => {
    const beforeStart = approvedReport({
      id: "01010101-0101-4101-8101-010101010101",
      reviewed_at: "2026-06-30T15:59:59.999Z",
      settled_batch_item_id: null,
    });
    const atStart = approvedReport({
      id: "02020202-0202-4202-8202-020202020202",
      reviewed_at: "2026-06-30T16:00:00.000Z",
      settled_batch_item_id: null,
    });
    const beforeEnd = approvedReport({
      id: "03030303-0303-4303-8303-030303030303",
      reviewed_at: "2026-07-10T15:59:59.999Z",
      settled_batch_item_id: null,
    });
    const atEnd = approvedReport({
      id: "04040404-0404-4404-8404-040404040404",
      reviewed_at: "2026-07-10T16:00:00.000Z",
      settled_batch_item_id: null,
    });
    const harness = await evidenceHarness({
      reports: [beforeStart, atStart, beforeEnd, atEnd],
      items: [],
      batches: [],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.reports.gte).toHaveBeenCalledWith(
      "reviewed_at",
      "2026-07-01T00:00:00.000+08:00",
    );
    expect(harness.reports.lt).toHaveBeenCalledWith(
      "reviewed_at",
      "2026-07-11T00:00:00.000+08:00",
    );
    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.records.map((record) => record.recordId)).toEqual([
      atStart.id,
      beforeEnd.id,
    ]);
  });

  it("excludes a non-overlapping locked batch even when its report review is in-window", async () => {
    const batch = lockedSettlementBatch({
      period_start: "2026-06-01",
      period_end: "2026-06-30",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport({ settled_batch_item_id: null })],
      items: [lockedSettlementItem({ settlement_batches: batch })],
      batches: [batch],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.batches.lte).toHaveBeenCalledWith(
      "period_start",
      "2026-07-10",
    );
    expect(harness.batches.gte).toHaveBeenCalledWith(
      "period_end",
      "2026-07-01",
    );
    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.records[0]?.currentRuleResult).toBeNull();
  });

  it("includes an overlapping locked batch when its report review is out-of-window", async () => {
    const report = approvedReport({
      reviewed_at: "2026-06-01T08:00:00.000Z",
      settled_batch_item_id: null,
    });
    const batch = lockedSettlementBatch({
      period_start: "2026-06-25",
      period_end: "2026-07-02",
    });
    const harness = await evidenceHarness({
      reports: [report],
      items: [lockedSettlementItem({ settlement_batches: batch })],
      batches: [batch],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "historical_settlements" });
    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "1250",
    });
  });

  it("rejects a non-overlapping locked batch returned despite production filters", async () => {
    const batch = lockedSettlementBatch({
      period_start: "2026-05-01",
      period_end: "2026-05-31",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: batch })],
      batches: [batch],
      enforceFilters: false,
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_EVIDENCE_INVALID",
      status: 500,
      retryable: true,
    });
  });

  it("matches a locked item by live_report_id when the report pointer is empty", async () => {
    const report = approvedReport({ settled_batch_item_id: null });
    const harness = await evidenceHarness({ reports: [report] });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.items.in).toHaveBeenCalledWith("settlement_batch_id", [
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ]);
    expect(evidence.sampleSource).toEqual({ kind: "historical_settlements" });
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "1250",
    });
  });

  it("selects the requested receivable item even when the report points at payable", async () => {
    const payableId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const receivable = lockedSettlementItem({
      id: "abababab-abab-4bab-8bab-abababababab",
      computed_amount: "25.00",
      manual_amount: "0.00",
      adjustment_amount: "0.00",
      settlement_batches: {
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
        status: "locked",
        batch_type: "receivable",
        locked_at: "2026-07-10T00:00:00.000Z",
      },
    });
    const harness = await evidenceHarness({
      reports: [approvedReport({ settled_batch_item_id: payableId })],
      items: [receivable],
      draft: evidenceDraft({
        businessContract: {
          scope: "receivable",
          executionGrain: "report",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "system_minutes" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.batches.eq).toHaveBeenCalledWith("batch_type", "receivable");
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "2500",
    });
  });

  it("keeps token and source hashes stable when only the report pointer changes", async () => {
    const withoutPointer = await evidenceHarness({
      reports: [approvedReport({ settled_batch_item_id: null })],
    });
    const oppositePointer = await evidenceHarness({
      reports: [
        approvedReport({
          settled_batch_item_id: "98989898-9898-4989-8989-989898989898",
        }),
      ],
    });

    const firstSelection =
      await withoutPointer.adapter.authorizeSelection(authorizationInput());
    const secondSelection =
      await oppositePointer.adapter.authorizeSelection(authorizationInput());
    const firstEvidence = await withoutPointer.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: firstSelection,
    });
    const secondEvidence = await oppositePointer.adapter.loadAuthorizedEvidence(
      {
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: secondSelection,
      },
    );

    expect(secondSelection.selectionToken).toBe(firstSelection.selectionToken);
    expect(secondEvidence.records[0]?.sourceVersion.version).toBe(
      firstEvidence.records[0]?.sourceVersion.version,
    );
    expect(secondEvidence.provenance.evidenceHash).toBe(
      firstEvidence.provenance.evidenceHash,
    );
  });

  it("keeps an approved-operation fallback population wholly unverified", async () => {
    const secondReportId = "12121212-1212-4212-8212-121212121212";
    const harness = await evidenceHarness({
      reports: [
        approvedReport({ settled_batch_item_id: null }),
        approvedReport({
          id: secondReportId,
          settled_batch_item_id: null,
          reviewed_at: "2026-07-06T08:00:00.000Z",
        }),
      ],
      items: [],
      batches: [],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSelection.populationCount).toBe(2);
    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.records).toHaveLength(2);
    expect(
      evidence.records.every((record) => record.currentRuleResult === null),
    ).toBe(true);
  });

  it("fails closed when one report has duplicate locked items for the requested scope", async () => {
    const harness = await evidenceHarness({
      reports: [approvedReport({ settled_batch_item_id: null })],
      items: [
        lockedSettlementItem(),
        lockedSettlementItem({
          id: "34343434-3434-4434-8434-343434343434",
          settlement_batches: {
            id: "56565656-5656-4565-8565-565656565656",
            status: "locked",
            batch_type: "payable",
            locked_at: "2026-07-10T00:00:00.000Z",
          },
        }),
      ],
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_EVIDENCE_AMBIGUOUS",
      status: 422,
      retryable: false,
    });
  });

  it("paginates 501 reports and aggregates the complete project period deterministically", async () => {
    const reports = Array.from({ length: 501 }, (_, index) =>
      approvedReport({
        id: fixtureUuid(index + 1, "1"),
        streamer_id: fixtureUuid((index % 2) + 1, "2"),
        settlement_duration: 1,
        system_duration: 2,
        settled_batch_item_id: null,
      }),
    );
    const items = reports.map((report, index) =>
      lockedSettlementItem({
        id: fixtureUuid(index + 1, "3"),
        live_report_id: report.id,
        computed_amount: "0.01",
        manual_amount: "0.00",
        adjustment_amount: "0.00",
        settlement_batches: {
          id: fixtureUuid(index + 1, "4"),
          status: "locked",
          batch_type: "payable",
          locked_at: "2026-07-10T00:00:00.000Z",
        },
      }),
    );
    const draft = evidenceDraft({
      businessContract: {
        scope: "payable",
        executionGrain: "project_period",
        businessTimezone: "Asia/Shanghai",
        requiredInputs: [
          { name: "period_report_count" },
          { name: "period_system_minutes" },
          { name: "period_settlement_minutes" },
        ],
      },
    });
    const first = await evidenceHarness({
      reports: [reports.slice(0, 500), reports.slice(500)],
      items: [items.slice(0, 500), items.slice(500)],
      streamers: [],
      draft,
    });
    const second = await evidenceHarness({
      reports: [reports.slice(0, 500), reports.slice(500)],
      items: [items.slice(0, 500), items.slice(500)],
      streamers: [],
      draft,
    });

    const firstSelection =
      await first.adapter.authorizeSelection(authorizationInput());
    const secondSelection =
      await second.adapter.authorizeSelection(authorizationInput());
    const firstEvidence = await first.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: firstSelection,
    });
    const secondEvidence = await second.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: secondSelection,
    });

    expect(first.batches.gt).toHaveBeenCalledWith("id", fixtureUuid(500, "4"));
    expect(firstEvidence.sampleSelection.populationCount).toBe(501);
    expect(firstEvidence.records).toHaveLength(1);
    expect(firstEvidence.records[0]).toMatchObject({
      variables: {
        period_report_count: { type: "integer", value: 501 },
        period_system_minutes: { type: "integer", value: 1002 },
        period_settlement_minutes: { type: "integer", value: 501 },
      },
      currentRuleResult: {
        unitSource: "current_rule_cents",
        amountCents: "501",
      },
    });
    expect(secondSelection.selectionToken).toBe(firstSelection.selectionToken);
    expect(secondEvidence.provenance.evidenceHash).toBe(
      firstEvidence.provenance.evidenceHash,
    );
    expect(secondEvidence.records[0]?.sourceVersion.version).toBe(
      firstEvidence.records[0]?.sourceVersion.version,
    );
  });

  it("aggregates project-streamer-period evidence per streamer", async () => {
    const secondReportId = "45454545-4545-4454-8454-454545454545";
    const secondItemId = "67676767-6767-4676-8676-676767676767";
    const harness = await evidenceHarness({
      reports: [
        approvedReport({ settled_batch_item_id: null }),
        approvedReport({
          id: secondReportId,
          settled_batch_item_id: null,
          system_duration: 30,
          settlement_duration: 20,
        }),
      ],
      items: [
        lockedSettlementItem(),
        lockedSettlementItem({
          id: secondItemId,
          live_report_id: secondReportId,
        }),
      ],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_streamer_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [
            { name: "period_report_count" },
            { name: "period_system_minutes" },
            { name: "period_settlement_minutes" },
            { name: "streamer_id" },
            { name: "base_salary" },
          ],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]).toMatchObject({
      recordId: expect.stringMatching(/^project_streamer_period:/u),
      variables: {
        streamer_id: {
          type: "string",
          value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
        base_salary: { type: "money_cents", amountCents: 100_000 },
        period_report_count: { type: "integer", value: 2 },
        period_system_minutes: { type: "integer", value: 90 },
        period_settlement_minutes: { type: "integer", value: 80 },
      },
      currentRuleResult: {
        unitSource: "current_rule_cents",
        amountCents: "2500",
      },
    });
  });

  it("keeps period computed amount separate from the locked current-rule total", async () => {
    const harness = await evidenceHarness({
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_payable_amount" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.records[0]).toMatchObject({
      variables: {
        period_payable_amount: {
          type: "money_cents",
          amountCents: 1000,
        },
      },
      currentRuleResult: {
        unitSource: "current_rule_cents",
        amountCents: "1250",
      },
    });
  });

  it("aggregates batch evidence by locked batch in stable order", async () => {
    const secondReportId = "89898989-8989-4898-8989-898989898989";
    const firstBatchId = "10101010-1010-4010-8010-101010101010";
    const secondBatchId = "20202020-2020-4020-8020-202020202020";
    const harness = await evidenceHarness({
      reports: [
        approvedReport({
          id: secondReportId,
          settled_batch_item_id: null,
        }),
        approvedReport({ settled_batch_item_id: null }),
      ],
      items: [
        lockedSettlementItem({
          id: "30303030-3030-4030-8030-303030303030",
          live_report_id: secondReportId,
          settlement_batches: {
            id: secondBatchId,
            status: "locked",
            batch_type: "payable",
            locked_at: "2026-07-10T00:00:00.000Z",
          },
        }),
        lockedSettlementItem({
          settlement_batches: {
            id: firstBatchId,
            status: "locked",
            batch_type: "payable",
            locked_at: "2026-07-10T00:00:00.000Z",
          },
        }),
      ],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "batch",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.records.map((record) => record.recordId)).toEqual([
      `batch:${firstBatchId}`,
      `batch:${secondBatchId}`,
    ]);
    expect(evidence.records.map((record) => record.currentRuleResult)).toEqual([
      { unitSource: "current_rule_cents", amountCents: "1250" },
      { unitSource: "current_rule_cents", amountCents: "1250" },
    ]);
  });

  it("includes null-report manual items in complete project-period totals", async () => {
    const batch = lockedSettlementBatch();
    const manualItem = lockedSettlementItem({
      id: "51515151-5151-4151-8151-515151515151",
      live_report_id: null,
      streamer_id: null,
      computed_amount: "5.00",
      manual_amount: "0.00",
      adjustment_amount: "0.00",
      settlement_batches: batch,
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: batch }), manualItem],
      batches: [batch],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "historical_settlements" });
    expect(evidence.sampleSelection.populationCount).toBe(2);
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "1750",
    });
  });

  it("builds a complete manual-only batch record without fabricating reports", async () => {
    const batch = lockedSettlementBatch();
    const harness = await evidenceHarness({
      reports: [],
      items: [
        lockedSettlementItem({
          live_report_id: null,
          streamer_id: null,
          computed_amount: "5.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      batches: [batch],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "batch",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSelection.populationCount).toBe(1);
    expect(evidence.records).toEqual([
      expect.objectContaining({
        recordId: `batch:${batch.id}`,
        variables: expect.objectContaining({
          period_report_count: { type: "integer", value: 0 },
        }),
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "500",
        },
      }),
    ]);
  });

  it("keeps report history unverified when its batch contains a manual aggregate item", async () => {
    const batch = lockedSettlementBatch();
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [
        lockedSettlementItem({ settlement_batches: batch }),
        lockedSettlementItem({
          id: "52525252-5252-4252-8252-525252525252",
          live_report_id: null,
          streamer_id: null,
          computed_amount: "5.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      batches: [batch],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.sampleSelection.populationCount).toBe(2);
    expect(evidence.records[0]?.currentRuleResult).toBeNull();
  });

  it("attributes a manual item by streamer for project-streamer-period totals", async () => {
    const batch = lockedSettlementBatch();
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [
        lockedSettlementItem({ settlement_batches: batch }),
        lockedSettlementItem({
          id: "53535353-5353-4353-8353-535353535353",
          live_report_id: null,
          computed_amount: "5.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      batches: [batch],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_streamer_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [
            { name: "period_report_count" },
            { name: "streamer_id" },
          ],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "historical_settlements" });
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "1750",
    });
  });

  it("keeps project-streamer-period history unverified for unattributable manual items", async () => {
    const batch = lockedSettlementBatch();
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [
        lockedSettlementItem({ settlement_batches: batch }),
        lockedSettlementItem({
          id: "54545454-5454-4454-8454-545454545454",
          live_report_id: null,
          streamer_id: null,
          computed_amount: "5.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      batches: [batch],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_streamer_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [
            { name: "period_report_count" },
            { name: "streamer_id" },
          ],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.records[0]?.currentRuleResult).toBeNull();
  });

  it("fails closed instead of double-counting duplicate settlement item IDs", async () => {
    const batch = lockedSettlementBatch();
    const item = lockedSettlementItem({ settlement_batches: batch });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [item, item],
      batches: [batch],
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_EVIDENCE_INVALID",
      status: 500,
      retryable: true,
    });
  });

  it("binds manual item IDs and amounts into selection and source hashes", async () => {
    const batch = lockedSettlementBatch();
    const draft = evidenceDraft({
      businessContract: {
        scope: "payable",
        executionGrain: "project_period",
        businessTimezone: "Asia/Shanghai",
        requiredInputs: [{ name: "period_report_count" }],
      },
    });
    const first = await evidenceHarness({
      reports: [approvedReport()],
      items: [
        lockedSettlementItem({ settlement_batches: batch }),
        lockedSettlementItem({
          id: "55555555-5555-4555-8555-555555555556",
          live_report_id: null,
          streamer_id: null,
          computed_amount: "5.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      batches: [batch],
      streamers: [],
      draft,
    });
    const second = await evidenceHarness({
      reports: [approvedReport()],
      items: [
        lockedSettlementItem({ settlement_batches: batch }),
        lockedSettlementItem({
          id: "55555555-5555-4555-8555-555555555556",
          live_report_id: null,
          streamer_id: null,
          computed_amount: "6.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      batches: [batch],
      streamers: [],
      draft,
    });

    const firstSelection =
      await first.adapter.authorizeSelection(authorizationInput());
    const secondSelection =
      await second.adapter.authorizeSelection(authorizationInput());
    const firstEvidence = await first.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: firstSelection,
    });
    const secondEvidence = await second.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: secondSelection,
    });

    expect(secondSelection.selectionToken).not.toBe(
      firstSelection.selectionToken,
    );
    expect(secondEvidence.records[0]?.sourceVersion.version).not.toBe(
      firstEvidence.records[0]?.sourceVersion.version,
    );
    expect(secondEvidence.provenance.evidenceHash).not.toBe(
      firstEvidence.provenance.evidenceHash,
    );
  });

  it("paginates more than 500 manual items without truncating batch totals", async () => {
    const batch = lockedSettlementBatch();
    const items = Array.from({ length: 501 }, (_, index) =>
      lockedSettlementItem({
        id: fixtureUuid(index + 1, "6"),
        live_report_id: null,
        streamer_id: null,
        computed_amount: "0.01",
        manual_amount: "0.00",
        adjustment_amount: "0.00",
        settlement_batches: batch,
      }),
    );
    const harness = await evidenceHarness({
      reports: [],
      items,
      batches: [batch],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.items.gt).toHaveBeenCalledWith("id", items[499]?.id);
    expect(evidence.sampleSelection.populationCount).toBe(501);
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "501",
    });
  });

  it("fails closed above 10,000 authorized manual source items", async () => {
    const batch = lockedSettlementBatch();
    const items = Array.from({ length: 10_001 }, (_, index) =>
      lockedSettlementItem({
        id: fixtureUuid(index + 1, "7"),
        live_report_id: null,
        streamer_id: null,
        computed_amount: "0.01",
        manual_amount: "0.00",
        adjustment_amount: "0.00",
        settlement_batches: batch,
      }),
    );
    const harness = await evidenceHarness({
      reports: [],
      items,
      batches: [batch],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_SELECTION_TOO_LARGE",
      status: 422,
      retryable: false,
    });
  });

  it("includes paired manual scope totals once in project-period margin", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "56565656-5656-4656-8656-565656565656",
      batch_type: "receivable",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [
        lockedSettlementItem({ settlement_batches: payableBatch }),
        lockedSettlementItem({
          id: "57575757-5757-4757-8757-575757575757",
          live_report_id: null,
          streamer_id: null,
          computed_amount: "5.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: payableBatch,
        }),
      ],
      pairedItems: [
        lockedSettlementItem({
          id: "58585858-5858-4858-8858-585858585858",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
        lockedSettlementItem({
          id: "59595959-5959-4959-8959-595959595959",
          live_report_id: null,
          streamer_id: null,
          computed_amount: "10.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBe("2250");
  });

  it.each([
    ["report", 2],
    ["project_streamer_period", 1],
    ["batch", 2],
    ["project_period", 1],
  ] as const)(
    "keeps partial %s history globally unverified",
    async (executionGrain, expectedRecords) => {
      const secondReportId = "41414141-4141-4141-8141-414141414141";
      const harness = await evidenceHarness({
        reports: [
          approvedReport({ settled_batch_item_id: null }),
          approvedReport({
            id: secondReportId,
            settled_batch_item_id: null,
          }),
        ],
        items: [],
        batches: [],
        draft: evidenceDraft({
          businessContract: {
            scope: "payable",
            executionGrain,
            businessTimezone: "Asia/Shanghai",
            requiredInputs: [
              {
                name:
                  executionGrain === "report"
                    ? "system_minutes"
                    : "period_report_count",
              },
            ],
          },
        }),
      });

      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const evidence = await harness.adapter.loadAuthorizedEvidence({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: authorized,
      });

      expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
      expect(evidence.sampleSelection.populationCount).toBe(2);
      expect(evidence.records).toHaveLength(expectedRecords);
      expect(
        evidence.records.every((record) => record.currentRuleResult === null),
      ).toBe(true);
    },
  );

  it.each([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ] as const)("returns explicit empty %s history", async (executionGrain) => {
    const harness = await evidenceHarness({
      reports: [],
      items: [],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain,
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [
            {
              name:
                executionGrain === "report"
                  ? "system_minutes"
                  : "period_report_count",
            },
          ],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.sampleSelection.populationCount).toBe(0);
    expect(evidence.records).toEqual([]);
  });

  it("loads scoped approved history with locked current-rule values", async () => {
    const harness = await evidenceHarness();

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(authorized.selectionToken).toMatch(/^server:[a-f0-9]{64}$/u);
    expect(evidence.sampleSource).toEqual({ kind: "historical_settlements" });
    expect(evidence.sampleSelection.populationCount).toBe(1);
    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]).toMatchObject({
      recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      variables: {
        system_minutes: { type: "integer", value: 60 },
        settlement_minutes: { type: "integer", value: 60 },
        base_hourly_rate: { type: "money_cents", amountCents: 10_000 },
        cps_rate: { type: "rate_bps", rateBps: 2000 },
      },
      currentRuleResult: {
        unitSource: "current_rule_cents",
        amountCents: "1250",
      },
    });
    expect(evidence.provenance.selectionToken).toBe(authorized.selectionToken);
    expect(evidence.provenance.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.provenance.immutableSourceVersions).toHaveLength(1);
    expect(harness.reports.eq).toHaveBeenCalledWith(
      "organization_id",
      ORGANIZATION_ID,
    );
    expect(harness.reports.eq).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect(harness.reports.eq).toHaveBeenCalledWith("status", "approved");
    expect(harness.reports.in).toHaveBeenCalledWith("id", [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(harness.reports.gte).not.toHaveBeenCalledWith(
      "reviewed_at",
      expect.anything(),
    );
    expect(harness.batches.eq).toHaveBeenCalledWith("status", "locked");
  });

  it("returns explicit approved-operation no-history semantics", async () => {
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.sampleSelection.populationCount).toBe(1);
    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]?.currentRuleResult).toBeNull();
    expect(JSON.stringify(evidence)).not.toContain("synthetic_scenarios");
  });

  it("returns empty approved-operation evidence when the project has no history", async () => {
    const harness = await evidenceHarness({ reports: [], items: [] });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.sampleSelection.populationCount).toBe(0);
    expect(evidence.records).toEqual([]);
    expect(harness.client.from).not.toHaveBeenCalledWith("project_streamers");
  });

  it("changes the trusted token and source version when selected evidence changes", async () => {
    const first = await evidenceHarness();
    const second = await evidenceHarness({
      items: [lockedSettlementItem({ adjustment_amount: "1.50" })],
    });

    const firstSelection =
      await first.adapter.authorizeSelection(authorizationInput());
    const secondSelection =
      await second.adapter.authorizeSelection(authorizationInput());
    const firstEvidence = await first.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: firstSelection,
    });
    const secondEvidence = await second.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: secondSelection,
    });

    expect(secondSelection.selectionToken).not.toBe(
      firstSelection.selectionToken,
    );
    expect(secondEvidence.records[0]?.sourceVersion.version).not.toBe(
      firstEvidence.records[0]?.sourceVersion.version,
    );
    expect(secondEvidence.provenance.evidenceHash).not.toBe(
      firstEvidence.provenance.evidenceHash,
    );
  });

  it("binds user examples into the trusted token and snapshots them separately from history", async () => {
    const example = {
      id: "user-standard",
      inputs: { system_minutes: { type: "integer" as const, value: 60 } },
      expectedResult: { type: "money_cents" as const, amountCents: 100 },
    };
    const harness = await evidenceHarness();
    const firstSelection = await harness.adapter.authorizeSelection(
      authorizationInput({ ...selection(), userExamples: [example] }),
    );

    example.expectedResult.amountCents = 999;
    const firstEvidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: firstSelection,
    });
    const secondSelection = await harness.adapter.authorizeSelection(
      authorizationInput({ ...selection(), userExamples: [example] }),
    );
    const secondEvidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: secondSelection,
    });

    expect(firstEvidence.userExamples).toEqual([
      {
        id: "user-standard",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 100 },
      },
    ]);
    expect(firstEvidence.records).toHaveLength(1);
    expect(firstEvidence.records[0]?.recordId).not.toContain("user-standard");
    expect(secondSelection.selectionToken).not.toBe(
      firstSelection.selectionToken,
    );
    expect(secondEvidence.provenance.evidenceHash).not.toBe(
      firstEvidence.provenance.evidenceHash,
    );
  });

  it("derives paired contribution margin as receivable minus payable", async () => {
    const harness = await evidenceHarness({
      pairedItems: [
        lockedSettlementItem({
          id: "76767676-7676-4767-8767-767676767676",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: {
            id: "77777777-7777-4777-8777-777777777777",
            status: "locked",
            batch_type: "receivable",
            locked_at: "2026-07-10T00:00:00.000Z",
          },
        }),
      ],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBe("1750");
  });

  it("subtracts confirmed linked costs from paired contribution margin", async () => {
    const harness = await evidenceHarness({
      pairedItems: [
        lockedSettlementItem({
          id: "78787878-7878-4787-8787-787878787878",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: {
            id: "79797979-7979-4797-8797-797979797979",
            status: "locked",
            batch_type: "receivable",
            locked_at: "2026-07-10T00:00:00.000Z",
          },
        }),
      ],
      costs: [confirmedCostItem()],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.costs.eq).toHaveBeenCalledWith("status", "confirmed");
    expect(evidence.currentMarginCents).toBe("1550");
  });

  it.each(["batch", "project_period"] as const)(
    "includes every in-period confirmed project cost once for %s margin",
    async (executionGrain) => {
      const payableBatch = lockedSettlementBatch();
      const receivableBatch = lockedSettlementBatch({
        id: "60606060-6060-4060-8060-606060606060",
        batch_type: "receivable",
      });
      const harness = await evidenceHarness({
        reports: [approvedReport()],
        items: [lockedSettlementItem({ settlement_batches: payableBatch })],
        pairedItems: [
          lockedSettlementItem({
            id: "61616161-6161-4161-8161-616161616161",
            computed_amount: "30.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
        ],
        batches: [payableBatch, receivableBatch],
        costs: [
          confirmedCostItem({
            id: "62626262-6262-4262-8262-626262626262",
            live_report_id: null,
            settlement_batch_id: null,
            amount_cents: "100",
            created_at: "2026-06-30T16:00:00.000Z",
          }),
          confirmedCostItem({
            id: "63636363-6363-4363-8363-636363636363",
            live_report_id: null,
            settlement_batch_id: null,
            amount_cents: "200",
            created_at: "2026-07-10T15:59:59.999Z",
          }),
          confirmedCostItem({
            id: "64646464-6464-4464-8464-646464646464",
            live_report_id: approvedReport().id,
            settlement_batch_id: payableBatch.id,
            amount_cents: "300",
            created_at: "2026-07-05T08:00:00.000Z",
          }),
          confirmedCostItem({
            id: "65656565-6565-4565-8565-656565656565",
            live_report_id: null,
            settlement_batch_id: null,
            amount_cents: "10000",
            created_at: "2026-06-30T15:59:59.999Z",
          }),
          confirmedCostItem({
            id: "66666666-6666-4666-8666-666666666666",
            live_report_id: null,
            settlement_batch_id: null,
            amount_cents: "10000",
            created_at: "2026-07-10T16:00:00.000Z",
          }),
        ],
        streamers: executionGrain === "batch" ? [] : undefined,
        draft: evidenceDraft({
          businessContract: {
            scope: "payable",
            executionGrain,
            businessTimezone: "Asia/Shanghai",
            requiredInputs: [{ name: "period_report_count" }],
          },
        }),
      });

      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const evidence = await harness.adapter.loadAuthorizedEvidence({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: authorized,
      });

      expect(harness.costs.gte).toHaveBeenCalledWith(
        "created_at",
        "2026-07-01T00:00:00.000+08:00",
      );
      expect(harness.costs.lt).toHaveBeenCalledWith(
        "created_at",
        "2026-07-11T00:00:00.000+08:00",
      );
      expect(evidence.currentMarginCents).toBe("1150");
    },
  );

  it.each(["report", "project_streamer_period"] as const)(
    "keeps %s margin unavailable when an in-period cost has no allocation link",
    async (executionGrain) => {
      const payableBatch = lockedSettlementBatch();
      const receivableBatch = lockedSettlementBatch({
        id: "67676767-6767-4767-8767-676767676767",
        batch_type: "receivable",
      });
      const harness = await evidenceHarness({
        reports: [approvedReport()],
        items: [lockedSettlementItem({ settlement_batches: payableBatch })],
        pairedItems: [
          lockedSettlementItem({
            id: "68686868-6868-4868-8868-686868686868",
            computed_amount: "30.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
        ],
        batches: [payableBatch, receivableBatch],
        costs: [
          confirmedCostItem({
            live_report_id: null,
            settlement_batch_id: null,
          }),
        ],
        draft: evidenceDraft({
          businessContract: {
            scope: "payable",
            executionGrain,
            businessTimezone: "Asia/Shanghai",
            requiredInputs: [
              {
                name:
                  executionGrain === "report"
                    ? "system_minutes"
                    : "period_report_count",
              },
            ],
          },
        }),
      });

      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const evidence = await harness.adapter.loadAuthorizedEvidence({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: authorized,
      });

      expect(evidence.currentMarginCents).toBeNull();
    },
  );

  it.each(["linked", "unlinked"] as const)(
    "keeps margin unavailable for a %s direction-ambiguous adjustment",
    async (linkage) => {
      const payableBatch = lockedSettlementBatch();
      const receivableBatch = lockedSettlementBatch({
        id: "69696969-6969-4969-8969-696969696969",
        batch_type: "receivable",
      });
      const harness = await evidenceHarness({
        reports: [approvedReport()],
        items: [lockedSettlementItem({ settlement_batches: payableBatch })],
        pairedItems: [
          lockedSettlementItem({
            id: "70707070-7070-4070-8070-707070707070",
            computed_amount: "30.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
        ],
        batches: [payableBatch, receivableBatch],
        costs: [
          confirmedCostItem({
            direction: "adjustment",
            live_report_id: linkage === "linked" ? approvedReport().id : null,
            settlement_batch_id: null,
          }),
        ],
        streamers: [],
        draft: evidenceDraft({
          businessContract: {
            scope: "payable",
            executionGrain: "project_period",
            businessTimezone: "Asia/Shanghai",
            requiredInputs: [{ name: "period_report_count" }],
          },
        }),
      });

      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const evidence = await harness.adapter.loadAuthorizedEvidence({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: authorized,
      });

      expect(evidence.currentMarginCents).toBeNull();
    },
  );

  it("counts a cost linked to both report and batch exactly once", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "71717171-7171-4171-8171-717171717171",
      batch_type: "receivable",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: payableBatch })],
      pairedItems: [
        lockedSettlementItem({
          id: "72727272-7272-4272-8272-727272727272",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      costs: [
        confirmedCostItem({
          live_report_id: approvedReport().id,
          settlement_batch_id: payableBatch.id,
        }),
      ],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBe("1550");
  });

  it("paginates all confirmed period costs before deriving aggregate margin", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "73737373-7373-4373-8373-737373737373",
      batch_type: "receivable",
    });
    const costs = Array.from({ length: 501 }, (_, index) =>
      confirmedCostItem({
        id: fixtureUuid(index + 1, "8"),
        live_report_id: null,
        settlement_batch_id: null,
        amount_cents: "1",
      }),
    );
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: payableBatch })],
      pairedItems: [
        lockedSettlementItem({
          id: "74747474-7474-4474-8474-747474747474",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      costs,
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.costs.gt).toHaveBeenCalledWith("id", costs[499]?.id);
    expect(evidence.currentMarginCents).toBe("1249");
  });

  it("keeps margin unavailable when paired locked scopes cover different periods", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "75757575-7575-4757-8757-757575757576",
      batch_type: "receivable",
      period_start: "2026-07-02",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: payableBatch })],
      pairedItems: [
        lockedSettlementItem({
          id: "76767676-7676-4767-8767-767676767677",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      costs: [],
      streamers: [],
      draft: evidenceDraft({
        businessContract: {
          scope: "payable",
          executionGrain: "project_period",
          businessTimezone: "Asia/Shanghai",
          requiredInputs: [{ name: "period_report_count" }],
        },
      }),
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBeNull();
  });

  it("keeps report margin unavailable when the paired batch has an extra report", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "77777777-7777-4777-8777-777777777778",
      batch_type: "receivable",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: payableBatch })],
      pairedItems: [
        lockedSettlementItem({
          id: "78787878-7878-4787-8787-787878787879",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
        lockedSettlementItem({
          id: "79797979-7979-4797-8797-797979797979",
          live_report_id: "80808080-8080-4080-8080-808080808080",
          streamer_id: "81818181-8181-4181-8181-818181818181",
          computed_amount: "10.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      costs: [],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBeNull();
  });

  it("keeps margin unavailable when the opposite locked scope is incomplete", async () => {
    const harness = await evidenceHarness();

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBeNull();
  });

  it.each([
    [
      "organization",
      { organization_id: "99999999-9999-4999-8999-999999999999" },
    ],
    ["project", { project_id: "99999999-9999-4999-8999-999999999999" }],
  ])(
    "rejects a cross-%s row even if a query returns it",
    async (_label, mismatch) => {
      const harness = await evidenceHarness({
        reports: [approvedReport(mismatch)],
        items: [],
        batches: [],
        enforceFilters: false,
      });

      await expect(
        harness.adapter.authorizeSelection(authorizationInput()),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        status: 404,
      });
    },
  );

  it("fails closed for unsupported selection criteria", async () => {
    const value = {
      ...selection(),
      criteriaCodes: ["approved_reports", "project_scope"],
    };
    const harness = await evidenceHarness();

    await expect(
      harness.adapter.authorizeSelection(authorizationInput(value)),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_SELECTION_UNSUPPORTED",
      status: 422,
      retryable: false,
    });
    expect(harness.client.from).not.toHaveBeenCalled();
  });
});

type SupportedGrain =
  | "report"
  | "project_streamer_period"
  | "batch"
  | "project_period";

function simulationContract(executionGrain: SupportedGrain) {
  const variableId =
    executionGrain === "report" ? "system_minutes" : "period_report_count";
  const inputValue = { type: "integer" as const, value: 1 };
  return businessRuleContractSchema.parse({
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain,
    compositionMode: "replace",
    title: "项目结算试算规则",
    summary: "使用授权证据验证每种执行粒度。",
    calculationComponents: [
      {
        name: "final",
        description: "返回固定一元用于验证聚合记录",
        expression: "yuan(1)",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: variableId,
        description: "授权执行上下文",
        source: `authorized.${variableId}`,
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: "个",
      },
    ],
    parameters: [
      {
        name: "fixed_amount",
        description: "固定试算金额",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元",
        defaultValue: { type: "money_cents", amountCents: 100 },
      },
    ],
    effectiveStartAt: "2026-07-01T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换授权执行上下文的基础金额。",
    businessTimezone: "Asia/Shanghai",
    examples: ["标准示例", "零值边界", "单值边界"].map((name, index) => ({
      name,
      kind: index === 0 ? "normal" : "boundary",
      description: "固定一元结果保持确定性。",
      inputs: { [variableId]: inputValue },
      expectedResult: { type: "money_cents", amountCents: 100 },
    })),
  });
}

function simulationDraft(executionGrain: SupportedGrain) {
  const contract = simulationContract(executionGrain);
  const formula = "money_result({ final: yuan(1) })";
  const validation = validateCustomRuleFormula(formula, {
    scope: contract.scope,
    executionGrain: contract.executionGrain,
    parameters: contract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  const parsed = parseCustomRuleFormula(formula);
  if (!validation.ok || !parsed.ok) throw new Error("Expected valid fixture");
  const parameters = Object.fromEntries(
    contract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  const variableId = contract.requiredInputs[0]?.name ?? "system_minutes";
  return {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: `service-${executionGrain}`,
    revisionNumber: 3,
    createdBy: USER_ID,
    createdAt: "2026-07-12T05:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
    status: "contract_ready",
    initialStatus: "contract_ready",
    promptText: "验证执行粒度",
    turnTrace: {
      turnId: "61616161-6161-4616-8616-616161616161",
      userMessageId: "62626262-6262-4626-8626-626262626262",
      assistantMessageId: "63636363-6363-4636-8636-636363636363",
    },
    businessContract: contract,
    variableCatalogVersion: "a".repeat(64),
    aiResponse: { kind: "fixture" },
    model: "deterministic-fixture",
    safetyFlags: [],
    contractHash: hashCustomRuleContract(contract),
    parameterHash: hashCustomRuleParameters(parameters),
    unresolvedAmbiguities: [],
    generatedFormula: { expression: formula, normalizedAst: parsed.ast },
    generatedExplanation: buildCustomRuleTemplateExplanation({
      ast: validation.compiledAst,
    }),
    generatedTestCases: [
      {
        name: "固定一元",
        inputs: { [variableId]: { type: "integer", value: 1 } },
        expectedResult: { type: "money_cents", amountCents: 100 },
      },
    ],
    formulaHash: validation.formulaHash,
  };
}

async function realPeriodTemplateFixture(templateId: string) {
  const template = getCustomRuleSystemTemplate(templateId);
  if (!template) throw new Error(`Missing system template: ${templateId}`);
  const actualCatalog = await vi.importActual<
    typeof import("./custom-rule-variable-catalog")
  >("./custom-rule-variable-catalog");
  const coverageItem = {
    numerator: 1,
    denominator: 1,
    latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
  };
  const catalog = actualCatalog.buildCustomRuleVariableCatalog({
    scope: template.contract.scope,
    executionGrain: template.contract.executionGrain,
    coverage: {
      hasHistory: true,
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "confirmed_contract",
      variables: {
        project_id: coverageItem,
        settlement_minutes: coverageItem,
      },
    },
  });
  const formulas: Record<string, string> = {
    "system:floor-cap:v1": `money_result({
      base: round_money(parameter("hourly_rate") * (period_settlement_minutes / 60)),
      final: clamp(base, parameter("minimum_guarantee"), parameter("maximum_cap"))
    })`,
    "system:group-bonus:v1":
      'money_result({ final: parameter("group_bonus") * period_report_count })',
    "system:base-plus-performance:v1": `money_result({
      final: parameter("base_salary") + parameter("order_bonus") * period_orders_count
    })`,
  };
  const formula = formulas[templateId];
  if (!formula) throw new Error(`Missing formula fixture: ${templateId}`);
  const validation = validateCustomRuleFormula(formula, {
    scope: template.contract.scope,
    executionGrain: template.contract.executionGrain,
    parameters: template.contract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  const parsed = parseCustomRuleFormula(formula);
  if (!validation.ok || !parsed.ok) {
    throw new Error(`Invalid system template formula fixture: ${templateId}`);
  }
  const parameters = Object.fromEntries(
    template.contract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  const draft = {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: `template-${templateId}`,
    revisionNumber: 3,
    createdBy: USER_ID,
    createdAt: "2026-07-12T05:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
    status: "contract_ready",
    initialStatus: "contract_ready",
    promptText: `Use ${templateId}`,
    turnTrace: {
      turnId: "61616161-6161-4616-8616-616161616161",
      userMessageId: "62626262-6262-4626-8626-626262626262",
      assistantMessageId: "63636363-6363-4636-8636-636363636363",
    },
    businessContract: template.contract,
    variableCatalogVersion: catalog.version,
    aiResponse: { kind: "system_template", templateId },
    model: "deterministic-system-template",
    safetyFlags: [],
    contractHash: hashCustomRuleContract(template.contract),
    parameterHash: hashCustomRuleParameters(parameters),
    unresolvedAmbiguities: [],
    generatedFormula: { expression: formula, normalizedAst: parsed.ast },
    generatedExplanation: buildCustomRuleTemplateExplanation({
      ast: validation.compiledAst,
    }),
    generatedTestCases: template.contract.examples.map((example) => ({
      name: example.name,
      inputs: example.inputs,
      expectedResult: example.expectedResult,
    })),
    formulaHash: validation.formulaHash,
  };
  return { catalog, draft };
}

async function realPeriodTemplateHarness(templateId: string) {
  const fixture = await realPeriodTemplateFixture(templateId);
  const catalog = {
    getCatalog: vi.fn().mockResolvedValue(fixture.catalog),
  };
  const harness = await evidenceHarness({
    reports: [approvedReport()],
    items: [lockedSettlementItem()],
    streamers: [joinedStreamer()],
    draft: fixture.draft,
    catalog,
  });
  const routeModule = await import("./custom-rule-route-context");
  const service = routeModule.createCustomRuleExistingDraftSimulationService({
    repository: harness.repository as never,
    catalog,
    evidence: harness.adapter as never,
  });
  return { ...fixture, ...harness, catalog, service };
}

async function simulationServiceHarness(
  executionGrain: SupportedGrain,
  history: "empty" | "partial" | "full",
  userExamples: Array<Record<string, unknown>> = [],
  options: {
    requestedItems?: unknown[];
    pairedItems?: unknown[];
    costs?: unknown[];
  } = {},
) {
  const draft = simulationDraft(executionGrain);
  const secondReportId = "91919191-9191-4919-8919-919191919191";
  const batch = {
    id: "92929292-9292-4929-8929-929292929292",
    status: "locked",
    batch_type: "payable",
    locked_at: "2026-07-10T00:00:00.000Z",
  };
  const reports =
    history === "empty"
      ? []
      : [
          approvedReport({ settled_batch_item_id: null }),
          approvedReport({
            id: secondReportId,
            settled_batch_item_id: null,
          }),
        ];
  const allItems = [
    lockedSettlementItem({ settlement_batches: batch }),
    lockedSettlementItem({
      id: "93939393-9393-4939-8939-939393939393",
      live_report_id: secondReportId,
      settlement_batches: batch,
    }),
  ];
  const harness = await evidenceHarness({
    reports,
    items:
      history === "empty" || history === "partial"
        ? []
        : (options.requestedItems ?? allItems),
    pairedItems: options.pairedItems,
    costs: options.costs,
    streamers: history === "empty" ? [] : [joinedStreamer()],
    draft,
  });
  const authorized = await harness.adapter.authorizeSelection(
    authorizationInput({ ...selection(), userExamples }),
  );
  const routeModule = await import("./custom-rule-route-context");
  const createService = (
    routeModule as typeof routeModule & {
      createCustomRuleExistingDraftSimulationService: (input: {
        repository: unknown;
        catalog: unknown;
        evidence: unknown;
        analyzeReadiness: (input: unknown) => unknown;
        simulate: typeof simulateCustomSettlementRule;
      }) => {
        simulateExistingDraft(input: Record<string, unknown>): Promise<{
          summary: {
            recordCount: number;
            totalOldCents: string | null;
            totalNewCents: string;
            totalDeltaCents: string | null;
            historicalVerification: { status: string };
            scenarios: Array<{
              category: string;
              id: string;
              passed: boolean;
            }>;
            warnings: Array<{
              code: string;
              severity: string;
              message: string;
            }>;
            riskFlags: Array<{
              code: string;
              severity: string;
              message: string;
            }>;
          };
        }>;
      };
    }
  ).createCustomRuleExistingDraftSimulationService;
  const service = createService({
    repository: harness.repository,
    catalog: {
      getCatalog: vi.fn().mockResolvedValue({
        scope: "payable",
        executionGrain,
        version: draft.variableCatalogVersion,
      }),
    },
    evidence: harness.adapter,
    analyzeReadiness: () => ({
      catalogVersion: draft.variableCatalogVersion,
      readinessHash: "b".repeat(64),
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "confirmed_contract",
      historicalVerification: "verified",
      readyForSimulation: true,
      readyForActivation: true,
      inputs: [],
      warnings: [],
    }),
    simulate: simulateCustomSettlementRule,
  });
  return service.simulateExistingDraft({
    actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
    projectId: PROJECT_ID,
    conversationId: draft.conversationId,
    draftId: draft.id,
    expectedRevisionNumber: draft.revisionNumber,
    clientRequestId: `request-${executionGrain}-${history}`,
    selection: authorized,
  });
}

describe("custom-rule evidence and Task 7 simulation integration", () => {
  it("adds an explicit warning when paired margin evidence is unavailable", async () => {
    const result = await simulationServiceHarness("report", "full");

    expect(result.summary.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_MARGIN_UNAVAILABLE" }),
    );
  });

  it("warns that margin is unavailable for approved-operation fallback", async () => {
    const result = await simulationServiceHarness("report", "partial");

    expect(result.summary.historicalVerification.status).toBe("unverified");
    expect(result.summary.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_MARGIN_UNAVAILABLE" }),
    );
  });

  it("triggers negative-margin risk with complete paired evidence", async () => {
    const batch = {
      id: "82828282-8282-4828-8828-828282828282",
      status: "locked",
      batch_type: "payable",
      locked_at: "2026-07-10T00:00:00.000Z",
    };
    const receivableBatch = {
      id: "83838383-8383-4838-8838-838383838383",
      status: "locked",
      batch_type: "receivable",
      locked_at: "2026-07-10T00:00:00.000Z",
    };
    const secondReportId = "91919191-9191-4919-8919-919191919191";
    const result = await simulationServiceHarness("report", "full", [], {
      requestedItems: [
        lockedSettlementItem({
          computed_amount: "0.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
        lockedSettlementItem({
          id: "84848484-8484-4848-8848-848484848484",
          live_report_id: secondReportId,
          computed_amount: "0.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: batch,
        }),
      ],
      pairedItems: [
        lockedSettlementItem({
          id: "85858585-8585-4858-8858-858585858585",
          computed_amount: "0.50",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
        lockedSettlementItem({
          id: "86868686-8686-4868-8868-868686868686",
          live_report_id: secondReportId,
          computed_amount: "0.50",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
    });

    expect(result.summary.riskFlags).toContainEqual(
      expect.objectContaining({
        code: "CUSTOM_RULE_NEGATIVE_MARGIN",
        severity: "block",
      }),
    );
  });

  it("warns instead of exposing report margin when a period cost is unlinked", async () => {
    const receivableBatch = {
      id: "87878787-8787-4787-8787-878787878787",
      status: "locked",
      batch_type: "receivable",
      locked_at: "2026-07-10T00:00:00.000Z",
    };
    const secondReportId = "91919191-9191-4919-8919-919191919191";
    const result = await simulationServiceHarness("report", "full", [], {
      pairedItems: [
        lockedSettlementItem({
          id: "88888888-8888-4888-8888-888888888888",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
        lockedSettlementItem({
          id: "89898989-8989-4898-8989-898989898980",
          live_report_id: secondReportId,
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      costs: [
        confirmedCostItem({
          live_report_id: null,
          settlement_batch_id: null,
        }),
      ],
    });

    expect(result.summary.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_MARGIN_UNAVAILABLE" }),
    );
  });

  it("triggers negative-margin risk from an unlinked project-period cost", async () => {
    const payableBatch = {
      id: "90909090-9090-4090-8090-909090909090",
      status: "locked",
      batch_type: "payable",
      locked_at: "2026-07-10T00:00:00.000Z",
    };
    const receivableBatch = {
      id: "91919191-9191-4191-8191-919191919190",
      status: "locked",
      batch_type: "receivable",
      locked_at: "2026-07-10T00:00:00.000Z",
    };
    const secondReportId = "91919191-9191-4919-8919-919191919191";
    const result = await simulationServiceHarness(
      "project_period",
      "full",
      [],
      {
        requestedItems: [
          lockedSettlementItem({
            computed_amount: "0.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: payableBatch,
          }),
          lockedSettlementItem({
            id: "92929292-9292-4292-8292-929292929292",
            live_report_id: secondReportId,
            computed_amount: "0.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: payableBatch,
          }),
        ],
        pairedItems: [
          lockedSettlementItem({
            id: "93939393-9393-4393-8393-939393939393",
            computed_amount: "0.50",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
          lockedSettlementItem({
            id: "94949494-9494-4494-8494-949494949494",
            live_report_id: secondReportId,
            computed_amount: "0.50",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
        ],
        costs: [
          confirmedCostItem({
            live_report_id: null,
            settlement_batch_id: null,
            amount_cents: "200",
          }),
        ],
      },
    );

    expect(result.summary.riskFlags).toContainEqual(
      expect.objectContaining({
        code: "CUSTOM_RULE_NEGATIVE_MARGIN",
        severity: "block",
      }),
    );
  });

  it("executes token-bound user examples without adding historical records", async () => {
    const result = await simulationServiceHarness("report", "full", [
      {
        id: "user-one-yuan",
        inputs: { system_minutes: { type: "integer", value: 30 } },
        expectedResult: { type: "money_cents", amountCents: 100 },
      },
    ]);

    expect(result.summary.recordCount).toBe(2);
    expect(result.summary.scenarios).toContainEqual(
      expect.objectContaining({
        category: "user_example",
        passed: true,
      }),
    );
  });

  it.each([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ] as const)("simulates full %s history", async (executionGrain) => {
    const result = await simulationServiceHarness(executionGrain, "full");

    expect(result.summary.historicalVerification.status).toBe("verified");
    expect(result.summary.totalOldCents).toBe("2500");
    expect(result.summary.totalDeltaCents).not.toBeNull();
  });

  it.each([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ] as const)(
    "keeps partial %s history unverified through Task 7",
    async (executionGrain) => {
      const result = await simulationServiceHarness(executionGrain, "partial");

      expect(result.summary.historicalVerification.status).toBe("unverified");
      expect(result.summary.totalOldCents).toBeNull();
      expect(result.summary.totalDeltaCents).toBeNull();
    },
  );

  it.each([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ] as const)("simulates empty %s history", async (executionGrain) => {
    const result = await simulationServiceHarness(executionGrain, "empty");

    expect(result.summary.recordCount).toBe(0);
    expect(result.summary.historicalVerification.status).toBe("unverified");
    expect(result.summary.totalOldCents).toBeNull();
    expect(result.summary.totalNewCents).toBe("0");
  });

  it.each([
    ["system:floor-cap:v1", "50000"],
    ["system:group-bonus:v1", "2000"],
  ] as const)(
    "simulates the real %s period template through catalog and readiness",
    async (templateId, expectedTotal) => {
      const harness = await realPeriodTemplateHarness(templateId);
      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const result = await harness.service.simulateExistingDraft({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        projectId: PROJECT_ID,
        conversationId: harness.draft.conversationId,
        draftId: harness.draft.id,
        expectedRevisionNumber: harness.draft.revisionNumber,
        clientRequestId: `request-${templateId}`,
        selection: authorized,
      });

      expect(harness.draft.status).toBe("contract_ready");
      expect(result.summary.historicalVerification.status).toBe("verified");
      expect(result.summary.totalNewCents).toBe(expectedTotal);
    },
  );

  it("keeps the order-count template contract-ready but blocks on unavailable readiness input", async () => {
    const harness = await realPeriodTemplateHarness(
      "system:base-plus-performance:v1",
    );

    expect(harness.draft.status).toBe("contract_ready");
    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    await expect(
      harness.service.simulateExistingDraft({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        projectId: PROJECT_ID,
        conversationId: harness.draft.conversationId,
        draftId: harness.draft.id,
        expectedRevisionNumber: harness.draft.revisionNumber,
        clientRequestId: "request-order-count-template",
        selection: authorized,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_DATA_NOT_READY",
      status: 422,
    });
  });
});
