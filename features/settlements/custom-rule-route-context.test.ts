import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { businessRuleContractSchema } from "./custom-rule-contract";
import { buildCustomRuleTemplateExplanation } from "./custom-rule-explanation";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import {
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type AuthorizedCustomRuleSimulationEvidence,
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

  it("keeps the RLS catalog available when generic conversation storage is unavailable", async () => {
    mocks.createAdminClient.mockReturnValue(null);
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const context = await getCustomRuleRouteContext();

    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) throw new Error("Expected route context");
    await context.catalog.getCatalog({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scope: "payable",
      executionGrain: "report",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();

    let caught: unknown;
    try {
      void context.conversation;
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  });

  it("keeps the RLS catalog available when AI providers are unconfigured", async () => {
    mocks.createProviders.mockReturnValue([]);
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const context = await getCustomRuleRouteContext();

    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) throw new Error("Expected route context");
    await context.catalog.getCatalog({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scope: "payable",
      executionGrain: "report",
    });
    expect(mocks.createProviders).not.toHaveBeenCalled();

    let caught: unknown;
    try {
      void context.authoring;
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CUSTOM_RULE_AI_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  });

  it("builds evidence and simulation without admin or AI dependencies", async () => {
    mocks.createAdminClient.mockReturnValue(null);
    mocks.createProviders.mockReturnValue([]);
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const context = await getCustomRuleRouteContext();

    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) throw new Error("Expected route context");
    expect(context.evidence).toBeDefined();
    expect(context.simulation).toBeDefined();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createProviders).not.toHaveBeenCalled();
  });

  it("memoizes specialized services per request without a mutable singleton", async () => {
    const { getCustomRuleRouteContext } =
      await import("./custom-rule-route-context");

    const first = await getCustomRuleRouteContext();
    const second = await getCustomRuleRouteContext();

    expect(first).not.toBeInstanceOf(Response);
    expect(second).not.toBeInstanceOf(Response);
    if (first instanceof Response || second instanceof Response) {
      throw new Error("Expected route contexts");
    }
    expect(mocks.repositoryConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createProviders).not.toHaveBeenCalled();
    expect(mocks.createConversationPersistence).not.toHaveBeenCalled();
    expect(mocks.createConversationService).not.toHaveBeenCalled();
    expect(mocks.createAuthoringService).not.toHaveBeenCalled();

    const firstAuthoring = first.authoring;
    expect(first.authoring).toBe(firstAuthoring);
    const secondAuthoring = second.authoring;
    expect(second.authoring).toBe(secondAuthoring);
    expect(firstAuthoring).not.toBe(secondAuthoring);
    expect(first.conversation).not.toBe(second.conversation);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(2);
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

function simulationUserExample(index: number) {
  return {
    id: `user-example-${index}`,
    inputs: { system_minutes: { type: "integer", value: index } },
    expectedResult: { type: "money_cents", amountCents: index },
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
  enforceReportFilters?: boolean;
  catalog?: unknown;
  snapshot?: unknown;
  rpcError?: unknown;
  snapshotAt?: string;
}) {
  const reportRows = flattenFixtureRows(input?.reports ?? [approvedReport()]);
  const itemRows = [
    ...flattenFixtureRows(input?.items ?? [lockedSettlementItem()]),
    ...flattenFixtureRows(input?.pairedItems ?? []),
  ];
  const batchRows =
    input?.batches ?? deriveSettlementBatchesFromItems(itemRows);
  const costRows = flattenFixtureRows(input?.costs ?? []);
  const streamerRows = flattenFixtureRows(
    input?.streamers ?? [joinedStreamer()],
  );
  const draft = input?.draft ?? evidenceDraft();
  const snapshotRows = selectSnapshotFixtureRows({
    reports: reportRows,
    items: itemRows,
    batches: batchRows,
    costs: costRows,
    streamers: streamerRows,
    draft,
    enforceFilters: input?.enforceFilters !== false,
    enforceReportFilters:
      (input?.enforceReportFilters ?? input?.enforceFilters) !== false,
  });
  const snapshot =
    input?.snapshot ??
    evidenceSnapshot({
      reports: snapshotRows.reports,
      items: snapshotRows.items,
      batches: snapshotRows.batches,
      costs: snapshotRows.costs,
      streamers: snapshotRows.streamers,
      draft,
      snapshotAt: input?.snapshotAt,
    });
  const client = {
    rpc: vi.fn().mockResolvedValue({
      data: input?.rpcError ? null : snapshot,
      error: input?.rpcError ?? null,
    }),
    from: vi.fn(() => {
      throw new Error("Evidence adapter must not issue table reads");
    }),
  };
  const repository = {
    listDrafts: vi.fn().mockResolvedValue([draft]),
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
        now?: () => Date;
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
        loadAuthorizedEvidence(
          input: Record<string, unknown>,
        ): Promise<AuthorizedCustomRuleSimulationEvidence>;
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
  const adapter = createAdapter({
    client,
    repository,
    catalog,
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  return {
    adapter,
    client,
    repository,
    catalog,
    snapshot,
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

function selectSnapshotFixtureRows(input: {
  reports: unknown[];
  items: unknown[];
  batches: unknown[];
  costs: unknown[];
  streamers: unknown[];
  draft: unknown;
  enforceFilters: boolean;
  enforceReportFilters: boolean;
}) {
  if (!input.enforceFilters) {
    return {
      reports: input.reports,
      items: input.items,
      batches: input.batches,
      costs: input.costs,
      streamers: input.streamers,
    };
  }
  const batches = input.batches.filter(
    (row) =>
      fixtureValue(row, "organization_id") === ORGANIZATION_ID &&
      fixtureValue(row, "project_id") === PROJECT_ID &&
      fixtureValue(row, "status") === "locked" &&
      String(fixtureValue(row, "period_start")) <= "2026-07-10" &&
      String(fixtureValue(row, "period_end")) >= "2026-07-01",
  );
  const batchIds = new Set(
    batches.map((row) => String(fixtureValue(row, "id"))),
  );
  const items = input.items.filter((row) =>
    batchIds.has(String(fixtureValue(row, "settlement_batch_id"))),
  );
  const linkedReportIds = new Set(
    items.flatMap((row) => {
      const id = fixtureValue(row, "live_report_id");
      return typeof id === "string" ? [id] : [];
    }),
  );
  const contract =
    input.draft && typeof input.draft === "object"
      ? Reflect.get(input.draft, "businessContract")
      : null;
  const timezone =
    contract && typeof contract === "object"
      ? String(Reflect.get(contract, "businessTimezone") ?? "Asia/Shanghai")
      : "Asia/Shanghai";
  const reports = input.enforceReportFilters
    ? input.reports.filter((row) => {
        if (fixtureValue(row, "status") !== "approved") return false;
        const id = fixtureValue(row, "id");
        if (typeof id === "string" && linkedReportIds.has(id)) return true;
        const businessDate = fixtureBusinessDate(
          fixtureValue(row, "reviewed_at"),
          timezone,
        );
        return businessDate >= "2026-07-01" && businessDate <= "2026-07-10";
      })
    : input.reports;
  const reportIds = new Set(
    reports.map((row) => String(fixtureValue(row, "id"))),
  );
  const costs = input.costs.filter((row) => {
    if (fixtureValue(row, "status") !== "confirmed") return false;
    const reportId = fixtureValue(row, "live_report_id");
    const batchId = fixtureValue(row, "settlement_batch_id");
    if (typeof reportId === "string" && reportIds.has(reportId)) return true;
    if (typeof batchId === "string" && batchIds.has(batchId)) return true;
    if (reportId !== null || batchId !== null) return false;
    const businessDate = fixtureBusinessDate(
      fixtureValue(row, "created_at"),
      timezone,
    );
    return businessDate >= "2026-07-01" && businessDate <= "2026-07-10";
  });
  const selectedStreamerIds = new Set<string>();
  for (const row of [...reports, ...items, ...costs]) {
    const id = fixtureValue(row, "streamer_id");
    if (typeof id === "string") selectedStreamerIds.add(id);
  }
  const streamers = input.streamers.filter((row) =>
    selectedStreamerIds.has(String(fixtureValue(row, "streamer_id"))),
  );
  return { reports, items, batches, costs, streamers };
}

function fixtureValue(row: unknown, key: string): unknown {
  return row && typeof row === "object" ? Reflect.get(row, key) : undefined;
}

function fixtureBusinessDate(value: unknown, timezone: string): string {
  if (typeof value !== "string") return "";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function evidenceSnapshot(input: {
  reports: unknown[];
  items: unknown[];
  batches: unknown[];
  costs: unknown[];
  streamers: unknown[];
  draft: unknown;
  snapshotAt?: string;
}) {
  const contract =
    input.draft && typeof input.draft === "object"
      ? Reflect.get(input.draft, "businessContract")
      : null;
  const scope =
    contract && typeof contract === "object"
      ? Reflect.get(contract, "scope")
      : "payable";
  const businessTimezone =
    contract && typeof contract === "object"
      ? String(Reflect.get(contract, "businessTimezone") ?? "Asia/Shanghai")
      : "Asia/Shanghai";
  const batches: Array<Record<string, unknown>> = input.batches.map((row) => {
    const source: Record<string, unknown> =
      row && typeof row === "object" ? { ...row } : {};
    const version = fixtureHash(source);
    return {
      ...source,
      title: source.title ?? "Settlement batch",
      created_at: source.created_at ?? "2026-07-01T00:00:00.000Z",
      updated_at: source.updated_at ?? "2026-07-10T00:00:00.000Z",
      computed_amount: canonicalNumericFixture(
        Reflect.get(source, "computed_amount") ?? "0",
      ),
      manual_amount: canonicalNumericFixture(
        Reflect.get(source, "manual_amount") ?? "0",
      ),
      adjustment_amount: canonicalNumericFixture(
        Reflect.get(source, "adjustment_amount") ?? "0",
      ),
      version,
    };
  });
  const batchVersions = new Map(
    batches.map((batch) => [String(batch.id), String(batch.version)]),
  );
  const items = input.items.map((row) => {
    const source: Record<string, unknown> =
      row && typeof row === "object" ? { ...row } : {};
    const batchId = String(Reflect.get(source, "settlement_batch_id") ?? "");
    const batch = batches.find(
      (candidate) => fixtureValue(candidate, "id") === batchId,
    );
    return {
      item_type: "live_report",
      evidence_level: "green",
      created_at: "2026-07-10T00:00:00.000Z",
      ...source,
      computed_amount: canonicalNumericFixture(
        Reflect.get(source, "computed_amount"),
      ),
      manual_amount: canonicalNumericFixture(
        Reflect.get(source, "manual_amount"),
      ),
      adjustment_amount: canonicalNumericFixture(
        Reflect.get(source, "adjustment_amount"),
      ),
      settlement_batches: {
        id: fixtureValue(batch, "id"),
        status: fixtureValue(batch, "status"),
        batch_type: fixtureValue(batch, "batch_type"),
        locked_at: fixtureValue(batch, "locked_at"),
        period_start: fixtureValue(batch, "period_start"),
        period_end: fixtureValue(batch, "period_end"),
        version: batchVersions.get(batchId) ?? "0".repeat(64),
      },
    };
  });
  const costs = input.costs.map((row) => ({
    streamer_id: null,
    ...(row && typeof row === "object" ? row : {}),
  }));
  const projectStreamers: Array<Record<string, unknown>> = input.streamers.map(
    (row) => ({
      ...(row && typeof row === "object" ? row : {}),
      status: fixtureValue(row, "status") ?? "active",
      hourly_rate: canonicalNumericFixture(fixtureValue(row, "hourly_rate")),
      base_salary: canonicalNumericFixture(fixtureValue(row, "base_salary")),
    }),
  );
  const streamerIds = new Set<string>();
  for (const row of [...input.reports, ...items, ...costs]) {
    if (!row || typeof row !== "object") continue;
    const streamerId = Reflect.get(row, "streamer_id");
    if (typeof streamerId === "string") streamerIds.add(streamerId);
  }
  const streamers = [...streamerIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const projectStreamer = projectStreamers.find(
        (row) => fixtureValue(row, "streamer_id") === id,
      );
      const relation = fixtureValue(projectStreamer, "streamers");
      const normalizedRelation = Array.isArray(relation)
        ? relation[0]
        : relation;
      return {
        id,
        organization_id: ORGANIZATION_ID,
        source_type:
          normalizedRelation && typeof normalizedRelation === "object"
            ? Reflect.get(normalizedRelation, "source_type")
            : "external",
      };
    });
  const sourceCount =
    batches.length +
    items.length +
    input.reports.length * 2 +
    costs.length +
    projectStreamers.length +
    streamers.length;
  const payload = {
    schema_version: 1,
    snapshot_version: 1,
    captured_at: input.snapshotAt ?? "2026-07-12T12:00:00.000Z",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    actor_id: USER_ID,
    scope,
    period_start: "2026-07-01",
    period_end: "2026-07-10",
    business_timezone: businessTimezone,
    business_timezone_confirmed: true,
    business_timezone_source: "contract_default",
    source_count: sourceCount,
    project: {
      id: PROJECT_ID,
      organization_id: ORGANIZATION_ID,
      code: "PRJ-001",
      name: "Settlement project",
      status: "active",
      updated_at: "2026-07-12T11:59:00.000Z",
      business_timezone: businessTimezone,
      business_timezone_confirmed: true,
      business_timezone_source: "contract_default",
    },
    settlement_batches: batches,
    settlement_batch_items: items,
    live_reports: input.reports,
    project_cost_items: costs,
    project_streamers: projectStreamers,
    streamers,
  };
  return { ...payload, snapshot_hash: fixtureHash(payload) };
}

function fixtureHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalNumericFixture(value: unknown): unknown {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return value;
  }
  const [whole, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/u, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
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

function periodBoundaryFixture(
  businessTimezone: string,
  expectedStart: string,
  expectedEnd: string,
) {
  const timestampType = {
    kind: "scalar" as const,
    scalarType: "timestamp" as const,
  };
  const contract = businessRuleContractSchema.parse({
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "project_period",
    compositionMode: "replace",
    title: "业务周期边界规则",
    summary: "使用已确认业务时区校验周期开始和结束时间边界。",
    calculationComponents: [
      {
        name: "final",
        description: "Returns one yuan only when both boundaries match.",
        expression: "Compare canonical period boundaries.",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: "period_start",
        description: "Canonical inclusive business-period start.",
        source: "authorized.period_start",
        valueType: timestampType,
        userFacingUnit: "timestamp",
      },
      {
        name: "period_end",
        description: "Canonical inclusive business-period end.",
        source: "authorized.period_end",
        valueType: timestampType,
        userFacingUnit: "timestamp",
      },
    ],
    parameters: [
      {
        name: "expected_start",
        description: "Expected canonical start instant.",
        valueType: timestampType,
        userFacingUnit: "timestamp",
        defaultValue: { type: "timestamp", value: expectedStart },
      },
      {
        name: "expected_end",
        description: "Expected canonical inclusive end instant.",
        valueType: timestampType,
        userFacingUnit: "timestamp",
        defaultValue: { type: "timestamp", value: expectedEnd },
      },
    ],
    effectiveStartAt: "2026-07-01T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription:
      "Replaces the project-period amount for boundary verification.",
    businessTimezone,
    examples: ["normal", "start", "end"].map((name, index) => ({
      name,
      kind: index === 0 ? "normal" : "boundary",
      description: "Canonical timestamp boundary comparison.",
      inputs: {
        period_start: { type: "timestamp", value: expectedStart },
        period_end: { type: "timestamp", value: expectedEnd },
      },
      expectedResult: { type: "money_cents", amountCents: 100 },
    })),
  });
  const formula = `money_result({
    final: if(
      period_start == parameter("expected_start") &&
      period_end == parameter("expected_end"),
      yuan(1),
      yuan(0)
    )
  })`;
  const validation = validateCustomRuleFormula(formula, {
    scope: contract.scope,
    executionGrain: contract.executionGrain,
    parameters: contract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  if (!validation.ok)
    throw new Error("Expected valid boundary formula fixture");
  const parameters = Object.fromEntries(
    contract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  return { contract, formula, validation, parameters };
}

describe("Supabase custom-rule authorized evidence adapter", () => {
  it("reads exactly one bounded lock-consistent snapshot RPC", async () => {
    const harness = await evidenceHarness();

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
    expect(harness.client.rpc).toHaveBeenCalledWith(
      "read_custom_settlement_evidence_snapshot",
      {
        p_organization_id: ORGANIZATION_ID,
        p_project_id: PROJECT_ID,
        p_scope: "payable",
        p_period_start: "2026-07-01",
        p_period_end: "2026-07-10",
        p_max_sources: 10_000,
      },
    );
    expect(harness.client.from).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", () => ({})],
    [
      "fractured",
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        source_count: Number(snapshot.source_count) + 1,
      }),
    ],
    [
      "stale",
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        captured_at: "2026-07-12T11:54:59.999Z",
      }),
    ],
    [
      "mismatched",
      (snapshot: Record<string, unknown>) => ({
        ...snapshot,
        project_id: "99999999-9999-4999-8999-999999999999",
      }),
    ],
  ] as const)("rejects a %s evidence snapshot", async (_kind, mutate) => {
    const harness = await evidenceHarness();
    const malformed = mutate(
      structuredClone(harness.snapshot) as Record<string, unknown>,
    );
    harness.client.rpc.mockResolvedValue({ data: malformed, error: null });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_EVIDENCE_INVALID",
      status: 500,
      retryable: true,
    });
  });

  it("maps snapshot RPC failures to a safe retryable storage error", async () => {
    const harness = await evidenceHarness({
      rpcError: { message: "database internal secret stack" },
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  });

  it("allows a 366-calendar-day inclusive range to reach repository and snapshot RPC", async () => {
    const harness = await evidenceHarness({
      reports: [],
      items: [],
      batches: [],
      costs: [],
      streamers: [],
    });
    harness.client.rpc.mockResolvedValue({
      data: {
        ...harness.snapshot,
        period_start: "2025-01-01",
        period_end: "2026-01-01",
      },
      error: null,
    });

    await expect(
      harness.adapter.authorizeSelection(
        authorizationInput({
          ...selection(),
          periodStart: "2025-01-01",
          periodEnd: "2026-01-01",
        }),
      ),
    ).resolves.toBeDefined();
    expect(harness.repository.listDrafts).toHaveBeenCalledTimes(1);
    expect(harness.client.rpc).toHaveBeenCalledWith(
      "read_custom_settlement_evidence_snapshot",
      expect.objectContaining({
        p_period_start: "2025-01-01",
        p_period_end: "2026-01-01",
      }),
    );
  });

  it("rejects a 367-calendar-day inclusive range before repository or snapshot RPC", async () => {
    const harness = await evidenceHarness();

    await expect(
      harness.adapter.authorizeSelection(
        authorizationInput({
          ...selection(),
          periodStart: "2025-01-01",
          periodEnd: "2026-01-02",
        }),
      ),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_SELECTION_TOO_LARGE",
      status: 422,
      retryable: false,
    });
    expect(harness.repository.listDrafts).not.toHaveBeenCalled();
    expect(harness.client.rpc).not.toHaveBeenCalled();
    expect(harness.client.from).not.toHaveBeenCalled();
  });

  it("rejects oversized user examples before draft, snapshot, or AI work", async () => {
    const harness = await evidenceHarness();

    await expect(
      harness.adapter.authorizeSelection(
        authorizationInput({
          ...selection(),
          userExamples: Array.from({ length: 51 }, (_, index) =>
            simulationUserExample(index),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
      retryable: false,
    });
    expect(harness.repository.listDrafts).not.toHaveBeenCalled();
    expect(harness.client.rpc).not.toHaveBeenCalled();
    expect(harness.client.from).not.toHaveBeenCalled();
  });

  it("rejects a snapshot that exceeds the bounded source contract", async () => {
    const harness = await evidenceHarness();
    harness.client.rpc.mockResolvedValue({
      data: {
        ...(harness.snapshot as Record<string, unknown>),
        source_count: 10_001,
      },
      error: null,
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_SELECTION_TOO_LARGE",
      status: 422,
      retryable: false,
    });
    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
  });

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

    expect(harness.client.rpc).toHaveBeenCalledWith(
      "read_custom_settlement_evidence_snapshot",
      expect.objectContaining({
        p_period_start: "2026-07-01",
        p_period_end: "2026-07-10",
      }),
    );
    expect(evidence.sampleSource).toEqual({ kind: "approved_operations" });
    expect(evidence.records.map((record) => record.recordId)).toEqual([
      atStart.id,
      beforeEnd.id,
    ]);
  });

  it.each([
    ["at the inclusive start", "2026-06-30T16:00:00.000Z"],
    ["just before the exclusive end", "2026-07-10T15:59:59.999Z"],
    ["as canonical Z", "2026-07-05T08:00:00Z"],
    [
      "with a positive HH:MM offset and fractional seconds",
      "2026-07-05T13:45:30.123456+05:30",
    ],
    [
      "with a negative HH:MM offset and fractional seconds",
      "2026-07-05T04:00:00.5-04:00",
    ],
  ] as const)(
    "post-validates fallback reviewed_at %s when report filters are ignored",
    async (_boundary, reviewedAt) => {
      const report = approvedReport({
        reviewed_at: reviewedAt,
        settled_batch_item_id: null,
      });
      const harness = await evidenceHarness({
        reports: [report],
        items: [],
        batches: [],
        enforceReportFilters: false,
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
      expect(evidence.records.map((record) => record.recordId)).toEqual([
        report.id,
      ]);
    },
  );

  it.each([
    ["before the inclusive start", "2026-06-30T15:59:59.999Z"],
    ["at the exclusive end", "2026-07-10T16:00:00.000Z"],
    ["with an offset-less local timestamp", "2026-07-05T08:00:00"],
    ["with a calendar-invalid timestamp", "2026-06-31T16:00:00.000Z"],
    ["with a date-only timestamp", "2026-07-05"],
    ["with a space-separated timestamp", "2026-07-05 08:00:00.000Z"],
    ["with a noncanonical offset", "2026-07-05T16:00:00.000+0800"],
    ["with a non-finite timestamp", "not-a-timestamp"],
    ["with a missing timestamp", null],
  ] as const)(
    "rejects fallback evidence %s when report filters are ignored",
    async (_boundary, reviewedAt) => {
      const validReport = approvedReport({
        id: "02020202-0202-4202-8202-020202020202",
        reviewed_at: "2026-06-30T16:00:00.000Z",
        settled_batch_item_id: null,
      });
      const invalidReport = approvedReport({
        id: "03030303-0303-4303-8303-030303030303",
        reviewed_at: reviewedAt,
        settled_batch_item_id: null,
      });
      const harness = await evidenceHarness({
        reports: [validReport, invalidReport],
        items: [],
        batches: [],
        enforceReportFilters: false,
      });

      await expect(
        harness.adapter.authorizeSelection(authorizationInput()),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_EVIDENCE_INVALID",
        status: 500,
        retryable: true,
      });
    },
  );

  it.each([
    ["Asia/Shanghai", "2026-06-30T16:00:00.000Z", "2026-07-10T15:59:59.999Z"],
    [
      "America/St_Johns",
      "2026-07-01T02:30:00.000Z",
      "2026-07-11T02:29:59.999Z",
    ],
  ] as const)(
    "emits canonical %s period timestamps and compares them in Task 7",
    async (businessTimezone, expectedStart, expectedEnd) => {
      const fixture = periodBoundaryFixture(
        businessTimezone,
        expectedStart,
        expectedEnd,
      );
      const catalogVersion = "a".repeat(64);
      const harness = await evidenceHarness({
        reports: [approvedReport()],
        items: [lockedSettlementItem()],
        streamers: [],
        draft: evidenceDraft({ businessContract: fixture.contract }),
        catalog: {
          getCatalog: vi.fn().mockResolvedValue({
            businessTimezone,
            businessTimezoneConfirmed: true,
            businessTimezoneSource: "confirmed_contract",
            variables: [],
          }),
        },
      });

      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const evidence = await harness.adapter.loadAuthorizedEvidence({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: authorized,
      });

      expect(evidence.records[0]?.variables).toMatchObject({
        period_start: { type: "timestamp", value: expectedStart },
        period_end: { type: "timestamp", value: expectedEnd },
      });
      const result = simulateCustomSettlementRule({
        organizationId: ORGANIZATION_ID,
        actorId: USER_ID,
        projectId: PROJECT_ID,
        contract: fixture.contract,
        compiledAst: fixture.validation.compiledAst,
        parameters: fixture.parameters,
        formulaHash: fixture.validation.formulaHash,
        contractHash: hashCustomRuleContract(fixture.contract),
        parameterHash: hashCustomRuleParameters(fixture.parameters),
        catalogVersion,
        readiness: {
          catalogVersion,
          readinessHash: "b".repeat(64),
          businessTimezone,
          businessTimezoneConfirmed: true,
          businessTimezoneSource: "confirmed_contract",
          historicalVerification: "verified",
          readyForSimulation: true,
          readyForActivation: true,
          inputs: ["period_start", "period_end"].map((variableId) => ({
            variableId,
            required: true,
            status: "available" as const,
            ready: true,
            coverageNumerator: 1,
            coverageDenominator: 1,
            code: "CUSTOM_RULE_INPUT_AVAILABLE" as const,
            reasonZh: "周期时间边界完整。",
          })),
          warnings: [],
        },
        ...evidence,
        aiTestCases: fixture.contract.examples.map((example) => ({
          name: example.name,
          inputs: example.inputs,
          expectedResult: example.expectedResult,
        })),
      });
      expect(result.totalNewCents).toBe("100");
    },
  );

  it("binds canonical timezone period semantics into selection and evidence hashes", async () => {
    const authorize = async (
      businessTimezone: string,
      expectedStart: string,
      expectedEnd: string,
    ) => {
      const fixture = periodBoundaryFixture(
        businessTimezone,
        expectedStart,
        expectedEnd,
      );
      const harness = await evidenceHarness({
        reports: [approvedReport()],
        items: [lockedSettlementItem()],
        streamers: [],
        draft: evidenceDraft({ businessContract: fixture.contract }),
        catalog: {
          getCatalog: vi.fn().mockResolvedValue({
            businessTimezone,
            businessTimezoneConfirmed: true,
            businessTimezoneSource: "confirmed_contract",
            variables: [],
          }),
        },
      });
      const authorized =
        await harness.adapter.authorizeSelection(authorizationInput());
      const evidence = await harness.adapter.loadAuthorizedEvidence({
        actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: authorized,
      });
      return { authorized, evidence };
    };
    const shanghai = await authorize(
      "Asia/Shanghai",
      "2026-06-30T16:00:00.000Z",
      "2026-07-10T15:59:59.999Z",
    );
    const stJohns = await authorize(
      "America/St_Johns",
      "2026-07-01T02:30:00.000Z",
      "2026-07-11T02:29:59.999Z",
    );

    expect(stJohns.authorized.selectionToken).not.toBe(
      shanghai.authorized.selectionToken,
    );
    expect(stJohns.evidence.records[0]?.sourceVersion.version).not.toBe(
      shanghai.evidence.records[0]?.sourceVersion.version,
    );
    expect(stJohns.evidence.provenance.evidenceHash).not.toBe(
      shanghai.evidence.provenance.evidenceHash,
    );
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
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

  it("requires approved report status in the immutable snapshot", async () => {
    const harness = await evidenceHarness();

    await harness.adapter.authorizeSelection(authorizationInput());

    expect(
      (harness.snapshot as { live_reports: Array<{ status: string }> })
        .live_reports[0]?.status,
    ).toBe("approved");
    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["draft", "pending_review", "rejected"])(
    "rejects a %s report returned by the fallback query despite status filters",
    async (status) => {
      const harness = await evidenceHarness({
        reports: [approvedReport({ status })],
        items: [],
        batches: [],
        enforceReportFilters: false,
      });

      await expect(
        harness.adapter.authorizeSelection(authorizationInput()),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_EVIDENCE_INVALID",
        status: 500,
        retryable: true,
      });
    },
  );

  it("rejects a non-approved report returned for a locked batch despite filters", async () => {
    const harness = await evidenceHarness({
      reports: [approvedReport({ status: "draft" })],
      enforceReportFilters: false,
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_EVIDENCE_INVALID",
      status: 500,
      retryable: true,
    });
  });

  it.each([
    ["settlement_duration", { settlement_duration: null }],
    ["time_source", { time_source: null }],
    ["evidence_level", { evidence_level: null }],
  ])(
    "rejects an approved report missing its %s snapshot field after query",
    async (_field, malformedSnapshot) => {
      const harness = await evidenceHarness({
        reports: [approvedReport(malformedSnapshot)],
        items: [],
        batches: [],
        enforceReportFilters: false,
      });

      await expect(
        harness.adapter.authorizeSelection(authorizationInput()),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_EVIDENCE_INVALID",
        status: 500,
        retryable: true,
      });
    },
  );

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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
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

    expect(harness.client.rpc).toHaveBeenCalledWith(
      "read_custom_settlement_evidence_snapshot",
      expect.objectContaining({ p_scope: "receivable" }),
    );
    expect(evidence.records[0]?.currentRuleResult).toEqual({
      unitSource: "current_rule_cents",
      amountCents: "2500",
    });
  });

  it("binds report pointer snapshot changes without changing accounting", async () => {
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

    expect(secondSelection.selectionToken).not.toBe(
      firstSelection.selectionToken,
    );
    expect(secondEvidence.records[0]?.sourceVersion.version).not.toBe(
      firstEvidence.records[0]?.sourceVersion.version,
    );
    expect(secondEvidence.records[0]?.currentRuleResult).toEqual(
      firstEvidence.records[0]?.currentRuleResult,
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

    expect(first.client.rpc).toHaveBeenCalledTimes(1);
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
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
    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
    expect(harness.client.from).not.toHaveBeenCalled();
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
    expect(evidence.currentMarginCents).toBe("1550");
  });

  it("preserves costs above MAX_SAFE_INTEGER as exact bigint cents", async () => {
    const amountCents = "9007199254740993";
    const harness = await evidenceHarness({
      pairedItems: [
        lockedSettlementItem({
          id: "89898989-8989-4989-8989-898989898989",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: {
            id: "90909090-9090-4090-8090-909090909090",
            status: "locked",
            batch_type: "receivable",
            locked_at: "2026-07-10T00:00:00.000Z",
          },
        }),
      ],
      costs: [confirmedCostItem({ amount_cents: amountCents })],
    });

    const authorized =
      await harness.adapter.authorizeSelection(authorizationInput());
    const evidence = await harness.adapter.loadAuthorizedEvidence({
      actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: authorized,
    });

    expect(evidence.currentMarginCents).toBe(
      (BigInt(1750) - BigInt(amountCents)).toString(),
    );
  });

  it("rejects JSON numbers for snapshot cost cents", async () => {
    const harness = await evidenceHarness({
      costs: [confirmedCostItem({ amount_cents: 200 })],
    });

    await expect(
      harness.adapter.authorizeSelection(authorizationInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_EVIDENCE_INVALID",
      status: 500,
      retryable: true,
    });
  });

  it.each([
    [
      "selected report",
      "live_report_id",
      {
        live_report_id: approvedReport().id,
        settlement_batch_id: null,
        created_at: "2026-07-20T08:00:00.000Z",
      },
    ],
    [
      "matching locked batch",
      "settlement_batch_id",
      {
        live_report_id: null,
        settlement_batch_id: lockedSettlementBatch().id,
        created_at: "2026-06-01T08:00:00.000Z",
      },
    ],
  ] as const)(
    "includes a confirmed cost linked to the %s regardless of created_at",
    async (_label, _expectedColumn, costOverrides) => {
      const payableBatch = lockedSettlementBatch();
      const receivableBatch = lockedSettlementBatch({
        id: "42424242-4242-4242-8242-424242424242",
        batch_type: "receivable",
      });
      const harness = await evidenceHarness({
        reports: [approvedReport()],
        items: [lockedSettlementItem({ settlement_batches: payableBatch })],
        pairedItems: [
          lockedSettlementItem({
            id: "43434343-4343-4343-8343-434343434343",
            computed_amount: "30.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
        ],
        batches: [payableBatch, receivableBatch],
        costs: [confirmedCostItem(costOverrides)],
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

      expect(harness.client.rpc).toHaveBeenCalledTimes(1);
      expect(evidence.currentMarginCents).toBe("1550");
    },
  );

  it("uses the business-date window only for fully unlinked confirmed costs", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "44444444-4444-4444-8444-444444444445",
      batch_type: "receivable",
    });
    const harness = await evidenceHarness({
      reports: [approvedReport()],
      items: [lockedSettlementItem({ settlement_batches: payableBatch })],
      pairedItems: [
        lockedSettlementItem({
          id: "45454545-4545-4545-8545-454545454545",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      costs: [
        confirmedCostItem({
          id: "46464646-4646-4646-8646-464646464646",
          live_report_id: null,
          settlement_batch_id: null,
          amount_cents: "200",
          created_at: "2026-07-05T08:00:00.000Z",
        }),
        confirmedCostItem({
          id: "47474747-4747-4747-8747-474747474747",
          live_report_id: null,
          settlement_batch_id: null,
          amount_cents: "10000",
          created_at: "2026-07-20T08:00:00.000Z",
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
    expect(evidence.currentMarginCents).toBe("1550");
  });

  it("includes a cost linked only to a report in the paired locked scope", async () => {
    const payableBatch = lockedSettlementBatch();
    const receivableBatch = lockedSettlementBatch({
      id: "48484848-4848-4848-8848-484848484848",
      batch_type: "receivable",
    });
    const pairedOnlyReportId = "49494949-4949-4949-8949-494949494949";
    const harness = await evidenceHarness({
      reports: [
        approvedReport(),
        approvedReport({
          id: pairedOnlyReportId,
          streamer_id: "52525252-5252-4252-8252-525252525252",
          settled_batch_item_id: null,
        }),
      ],
      items: [lockedSettlementItem({ settlement_batches: payableBatch })],
      pairedItems: [
        lockedSettlementItem({
          id: "50505050-5050-4050-8050-505050505050",
          computed_amount: "30.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
        lockedSettlementItem({
          id: "51515151-5151-4151-8151-515151515152",
          live_report_id: pairedOnlyReportId,
          streamer_id: "52525252-5252-4252-8252-525252525252",
          computed_amount: "10.00",
          manual_amount: "0.00",
          adjustment_amount: "0.00",
          settlement_batches: receivableBatch,
        }),
      ],
      batches: [payableBatch, receivableBatch],
      costs: [
        confirmedCostItem({
          live_report_id: pairedOnlyReportId,
          settlement_batch_id: null,
          amount_cents: "200",
          created_at: "2026-07-20T08:00:00.000Z",
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
    expect(evidence.currentMarginCents).toBe("2550");
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

      expect(harness.client.rpc).toHaveBeenCalledTimes(1);
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
          created_at: "2026-07-20T08:00:00.000Z",
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
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

    expect(harness.client.rpc).toHaveBeenCalledTimes(1);
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

  it("marks unlinked in-period cost accounting as provisional", async () => {
    const receivableBatch = {
      id: "95959595-9595-4595-8595-959595959595",
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
        pairedItems: [
          lockedSettlementItem({
            id: "96969696-9696-4696-8696-969696969696",
            computed_amount: "30.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
          lockedSettlementItem({
            id: "97979797-9797-4797-8797-979797979797",
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
            created_at: "2026-07-05T08:00:00.000Z",
          }),
        ],
      },
    );

    expect(result.summary.warnings).toContainEqual(
      expect.objectContaining({
        code: "CUSTOM_RULE_MARGIN_PROVISIONAL",
        severity: "warning",
      }),
    );
  });

  it("blocks negative margin from a late-created selected-report cost", async () => {
    const payableBatch = {
      id: "98989898-9898-4898-8898-989898989898",
      status: "locked",
      batch_type: "payable",
      locked_at: "2026-07-10T00:00:00.000Z",
    };
    const receivableBatch = {
      id: "99999999-9999-4999-8999-999999999998",
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
            id: "10101010-1010-4010-8010-101010101011",
            live_report_id: secondReportId,
            computed_amount: "0.00",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: payableBatch,
          }),
        ],
        pairedItems: [
          lockedSettlementItem({
            id: "11111111-1111-4111-8111-111111111112",
            computed_amount: "0.50",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
          lockedSettlementItem({
            id: "12121212-1212-4212-8212-121212121213",
            live_report_id: secondReportId,
            computed_amount: "0.50",
            manual_amount: "0.00",
            adjustment_amount: "0.00",
            settlement_batches: receivableBatch,
          }),
        ],
        costs: [
          confirmedCostItem({
            live_report_id: approvedReport().id,
            settlement_batch_id: null,
            amount_cents: "200",
            created_at: "2026-07-20T08:00:00.000Z",
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
