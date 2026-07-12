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
