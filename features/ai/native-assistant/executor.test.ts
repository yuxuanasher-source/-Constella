import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildNativeAssistantContextMock,
  createActorAssertionMock,
  createSupabaseServerClientMock,
  getAuthContextMock,
  resolveHermesRuntimeConfigMock,
} = vi.hoisted(() => ({
  buildNativeAssistantContextMock: vi.fn(),
  createActorAssertionMock: vi.fn(),
  createSupabaseServerClientMock: vi.fn(),
  getAuthContextMock: vi.fn(),
  resolveHermesRuntimeConfigMock: vi.fn(),
}));

vi.mock("./context-engine", () => ({
  buildNativeAssistantContext: buildNativeAssistantContextMock,
}));

vi.mock("@/features/ai/hermes/runtime-client", () => ({
  createHermesActorAssertionForRun: createActorAssertionMock,
  getHermesRunEventResponse: vi.fn(),
  readHermesRunEvents: vi.fn(),
  resolveHermesRuntimeConfig: resolveHermesRuntimeConfigMock,
  startHermesRun: vi.fn(),
}));

vi.mock("@/features/ai/invocation-ledger", () => ({
  recordAiInvocation: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: getAuthContextMock,
}));

import { executeNativeHermesAssistant } from "./executor";

describe("native Hermes executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClientMock.mockResolvedValue({});
    getAuthContextMock.mockResolvedValue(AUTH);
    resolveHermesRuntimeConfigMock.mockReturnValue(RUNTIME_CONFIG);
    buildNativeAssistantContextMock.mockReturnValue(LEGACY_CONTEXT);
    createActorAssertionMock.mockRejectedValue(new Error("stop after context"));
  });

  it("passes the normalized mode into context assembly and reuses its mode", async () => {
    const onContextReady = vi.fn();

    await executeNativeHermesAssistant(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
          mode: "deep",
        }),
      }),
      {
        nativeAssistant: {
          conversationId: CONVERSATION_ID,
          invocationId: INVOCATION_ID,
        },
        onContextReady,
      },
    );

    expect(buildNativeAssistantContextMock).toHaveBeenCalledWith({
      auth: AUTH,
      conversationId: CONVERSATION_ID,
      invocationId: INVOCATION_ID,
      clientRequest: {
        message: "hello",
        mode: "deep",
        pageContext: undefined,
        attachmentIds: [],
      },
    });
    expect(onContextReady).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fast" }),
    );
  });
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const EMPTY_SKILL_HASH =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

const AUTH = {
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  role: "finance",
};

const RUNTIME_CONFIG = {
  baseUrl: "https://hermes.internal",
  serviceToken: "s".repeat(32),
  privateKeyPem: "private-key",
  keyId: "key-1",
};

const LEGACY_CONTEXT = {
  assistant: { displayName: "星耀 AI", kernelId: "hermes-agent-fork" },
  message: "hello",
  mode: "fast",
  attachmentIds: [],
  actor: {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "finance",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["context.read"],
    enabledSkillVersions: [],
    skillGrantsHash: EMPTY_SKILL_HASH,
    profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    pageContext: { pageType: "global", objectIds: [] },
  },
  skillAudit: {
    type: "hermes.skill_grants.evaluated",
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "finance",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    builtinSkillsSha256: "c1755ec71e802748",
    enabledSkillIds: [],
    skillGrantsHash: EMPTY_SKILL_HASH,
    decisions: [],
  },
};
