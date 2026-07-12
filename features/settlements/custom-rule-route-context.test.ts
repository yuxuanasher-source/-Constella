import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

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
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  returns: ReturnType<typeof vi.fn>;
};

function queryChain(data: unknown[], error: unknown = null): QueryChain {
  const query = {} as QueryChain;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.gte = vi.fn(() => query);
  query.lte = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.not = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.returns = vi.fn().mockResolvedValue({ data, error });
  return query;
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

function lockedSettlementItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    live_report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    computed_amount: "10.00",
    manual_amount: "2.00",
    adjustment_amount: "0.50",
    settlement_batches: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      status: "locked",
      batch_type: "payable",
      locked_at: "2026-07-10T00:00:00.000Z",
    },
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
  };
}

async function evidenceHarness(input?: {
  reports?: unknown[];
  items?: unknown[];
  streamers?: unknown[];
  draft?: ReturnType<typeof evidenceDraft>;
}) {
  const reports = queryChain(input?.reports ?? [approvedReport()]);
  const items = queryChain(input?.items ?? [lockedSettlementItem()]);
  const streamers = queryChain(input?.streamers ?? [joinedStreamer()]);
  const client = {
    from: vi.fn((table: string) => {
      if (table === "live_reports") return reports;
      if (table === "settlement_batch_items") return items;
      if (table === "project_streamers") return streamers;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  const repository = {
    listDrafts: vi.fn().mockResolvedValue([input?.draft ?? evidenceDraft()]),
  };
  const routeModule = await import("./custom-rule-route-context");
  const createAdapter = (
    routeModule as typeof routeModule & {
      createSupabaseCustomRuleEvidenceAdapter: (input: {
        client: unknown;
        repository: unknown;
      }) => {
        authorizeSelection(input: Record<string, unknown>): Promise<{
          selectionToken: string;
          periodStart: string;
          periodEnd: string;
          criteriaCodes: readonly string[];
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
  const adapter = createAdapter({ client, repository });
  return { adapter, client, repository, reports, items, streamers };
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
    expect(harness.reports.gte).toHaveBeenCalledWith(
      "reviewed_at",
      "2026-07-01T00:00:00.000Z",
    );
    expect(harness.reports.lte).toHaveBeenCalledWith(
      "reviewed_at",
      "2026-07-10T23:59:59.999Z",
    );
    expect(harness.items.eq).toHaveBeenCalledWith(
      "settlement_batches.status",
      "locked",
    );
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
    expect(evidence.records).toEqual([]);
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
      });

      await expect(
        harness.adapter.authorizeSelection(authorizationInput()),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        status: 404,
      });
    },
  );

  it.each([
    {
      ...selection(),
      criteriaCodes: ["approved_reports", "project_scope"],
    },
    selection(),
  ])(
    "fails closed for unsupported selection or execution grain",
    async (value) => {
      const draft =
        value.criteriaCodes.length === 4
          ? evidenceDraft({
              businessContract: {
                scope: "payable",
                executionGrain: "project_period",
                businessTimezone: "Asia/Shanghai",
                requiredInputs: [{ name: "period_settlement_minutes" }],
              },
            })
          : evidenceDraft();
      const harness = await evidenceHarness({ draft });

      await expect(
        harness.adapter.authorizeSelection(authorizationInput(value)),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_SELECTION_UNSUPPORTED",
        status: 422,
        retryable: false,
      });
      expect(harness.client.from).not.toHaveBeenCalled();
    },
  );
});
