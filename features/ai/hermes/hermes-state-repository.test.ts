import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  HermesStateRepositoryError,
  assertHermesSanitizedObject,
  createHermesStateRepository,
  type HermesCapabilityActorSnapshot,
  type HermesRunCapabilityBinding,
  type HermesStateActor,
  type HermesStateRepository,
  type HermesStateRepositoryClient,
} from "./hermes-state-repository";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const TURN_ID = "00000000-0000-4000-8000-000000000004";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000005";
const PARENT_INVOCATION_ID = "00000000-0000-4000-8000-000000000006";
const CAPABILITY_ID = "00000000-0000-4000-8000-000000000007";
const BROKER_CALL_ID = "00000000-0000-4000-8000-000000000008";
const CLAIM_OWNER_ID = "00000000-0000-4000-8000-000000000009";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000010";
const SKILL_DRAFT_ID_A = "00000000-0000-4000-8000-000000000011";
const SKILL_DRAFT_ID_B = "00000000-0000-4000-8000-000000000012";
const MEMORY_ID = "00000000-0000-4000-8000-000000000013";
const MEMORY_KEY = "00000000-0000-4000-8000-000000000014";
const DRAFT_ID = "00000000-0000-4000-8000-000000000015";
const TOKEN_SHA256 = "a".repeat(64);
const PARENT_TOKEN_SHA256 = "b".repeat(64);
const ACTOR_FINGERPRINT = "c".repeat(64);
const REQUEST_SHA256 = "d".repeat(64);

const actor: HermesStateActor = {
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  invocationId: INVOCATION_ID,
};

const actorSnapshot: HermesCapabilityActorSnapshot = {
  ...actor,
  actorFingerprint: ACTOR_FINGERPRINT,
};

const capabilityBinding: HermesRunCapabilityBinding = {
  tokenSha256: TOKEN_SHA256,
  allowedTools: ["tool.zeta", "tool.alpha"],
  scopes: ["projects.search", "context.read"],
  skillDraftIds: [SKILL_DRAFT_ID_B, SKILL_DRAFT_ID_A],
  depth: 1,
  aiStateWritesAllowed: false,
  parentCapability: {
    invocationId: PARENT_INVOCATION_ID,
    tokenSha256: PARENT_TOKEN_SHA256,
  },
};

function persistedJsonOperations(
  payload: Record<string, unknown>,
): Array<(repository: HermesStateRepository) => Promise<unknown>> {
  return [
    (repository) =>
      repository.claimBrokerCall(
        actor,
        TOKEN_SHA256,
        ACTOR_FINGERPRINT,
        CLAIM_OWNER_ID,
        "tool-call-secret",
        "tool.alpha",
        REQUEST_SHA256,
        payload,
      ),
    (repository) =>
      repository.completeBrokerCall(
        actor,
        BROKER_CALL_ID,
        CLAIM_OWNER_ID,
        1,
        "completed",
        payload,
        { content: "Tool completed", metadata: payload },
      ),
    (repository) =>
      repository.appendToolMessage(actor, TURN_ID, {
        content: "Tool completed",
        metadata: payload,
      }),
    (repository) =>
      repository.upsertSkillDraft(actor, {
        skillId: "risk_review",
        version: 1,
        manifest: payload,
        bundle: "skill bundle",
      }),
    (repository) =>
      repository.compareAndSwapGatewayState(actor, CONVERSATION_ID, 1, {
        generation: 2,
        ...payload,
      }),
    (repository) =>
      repository.finishTurn(actor, TURN_ID, {
        outcome: "complete",
        content: "Complete",
        retryable: false,
        metadata: payload,
      }),
  ];
}

function payloadShapes(key: string, value: unknown): Record<string, unknown>[] {
  const ownKeyObject = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return payload;
  };

  return [
    ownKeyObject(),
    { nested: ownKeyObject() },
    { items: [ownKeyObject()] },
  ];
}

describe("Hermes state repository", () => {
  it("issues a capability with canonical bindings and never persists raw secrets", async () => {
    const { client, rpc, calls } = rpcClient({
      data: {
        capability_id: CAPABILITY_ID,
        expires_at: "2026-07-22T05:05:00.000Z",
      },
      error: null,
    });
    const repository = createHermesStateRepository(client);
    const poisonedActor = {
      ...actorSnapshot,
      actorAssertion: "actor-jws-secret",
    } satisfies HermesCapabilityActorSnapshot & { actorAssertion: string };
    const poisonedBinding = {
      ...capabilityBinding,
      rawCapability: "raw-capability-secret",
    } satisfies HermesRunCapabilityBinding & { rawCapability: string };

    await expect(
      repository.issueRunCapability(
        poisonedActor,
        { id: TURN_ID, conversationId: CONVERSATION_ID },
        poisonedBinding,
        new Date("2026-07-22T05:05:00.000Z"),
      ),
    ).resolves.toEqual({
      capabilityId: CAPABILITY_ID,
      expiresAt: "2026-07-22T05:05:00.000Z",
    });

    expect(rpc).toHaveBeenCalledWith("issue_ai_hermes_run_capability", {
      p_token_sha256: TOKEN_SHA256,
      p_organization_id: ORGANIZATION_ID,
      p_owner_user_id: USER_ID,
      p_conversation_id: CONVERSATION_ID,
      p_turn_id: TURN_ID,
      p_invocation_id: INVOCATION_ID,
      p_parent_invocation_id: PARENT_INVOCATION_ID,
      p_parent_token_sha256: PARENT_TOKEN_SHA256,
      p_actor_fingerprint: ACTOR_FINGERPRINT,
      p_allowed_tools: ["tool.alpha", "tool.zeta"],
      p_allowed_tools_hash: postgresArrayHash(["tool.alpha", "tool.zeta"]),
      p_scopes: ["context.read", "projects.search"],
      p_scope_hash: postgresArrayHash(["context.read", "projects.search"]),
      p_skill_grants_hash: postgresArrayHash([
        SKILL_DRAFT_ID_A,
        SKILL_DRAFT_ID_B,
      ]),
      p_skill_draft_ids: [SKILL_DRAFT_ID_A, SKILL_DRAFT_ID_B],
      p_depth: 1,
      p_ai_state_writes_allowed: false,
      p_expires_at: "2026-07-22T05:05:00.000Z",
    });
    expect(JSON.stringify(calls)).not.toContain("raw-capability-secret");
    expect(JSON.stringify(calls)).not.toContain("actor-jws-secret");
  });

  it("rejects capability depth 3 before calling the database", async () => {
    const { client, rpc } = rpcClient({
      data: {
        capability_id: CAPABILITY_ID,
        expires_at: "2026-07-22T05:05:00.000Z",
      },
      error: null,
    });

    await expect(
      createHermesStateRepository(client).issueRunCapability(
        actorSnapshot,
        { id: TURN_ID, conversationId: CONVERSATION_ID },
        { ...capabilityBinding, depth: 3 },
        new Date("2026-07-22T05:05:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("claims and completes broker calls with claim ownership and fencing", async () => {
    const claimClient = rpcClient({
      data: {
        broker_call_id: BROKER_CALL_ID,
        status: "claimed",
        execute: true,
        reused: false,
        fencing_token: 7,
        sanitized_response_envelope: null,
      },
      error: null,
    });
    const claimRepository = createHermesStateRepository(claimClient.client);

    await expect(
      claimRepository.claimBrokerCall(
        actor,
        TOKEN_SHA256,
        ACTOR_FINGERPRINT,
        CLAIM_OWNER_ID,
        "tool-call-1",
        "tool.alpha",
        REQUEST_SHA256,
        { query: "risk" },
      ),
    ).resolves.toMatchObject({ brokerCallId: BROKER_CALL_ID, fencingToken: 7 });
    expect(claimClient.rpc).toHaveBeenCalledWith(
      "claim_ai_hermes_broker_call",
      {
        p_organization_id: ORGANIZATION_ID,
        p_owner_user_id: USER_ID,
        p_token_sha256: TOKEN_SHA256,
        p_actor_fingerprint: ACTOR_FINGERPRINT,
        p_claim_owner_id: CLAIM_OWNER_ID,
        p_tool_call_id: "tool-call-1",
        p_tool_name: "tool.alpha",
        p_request_sha256: REQUEST_SHA256,
        p_sanitized_request_envelope: { query: "risk" },
      },
    );

    const completeClient = rpcClient({
      data: {
        broker_call_id: BROKER_CALL_ID,
        status: "completed",
        reused: false,
        fencing_token: 7,
        message_id: MESSAGE_ID,
        sequence_no: 9,
      },
      error: null,
    });
    const completeRepository = createHermesStateRepository(
      completeClient.client,
    );
    await expect(
      completeRepository.completeBrokerCall(
        actor,
        BROKER_CALL_ID,
        CLAIM_OWNER_ID,
        7,
        "completed",
        { status: "ok" },
        {
          content: "Sanitized tool result",
          metadata: { toolCallId: "tool-call-1", truncated: false },
        },
      ),
    ).resolves.toMatchObject({
      brokerCallId: BROKER_CALL_ID,
      messageId: MESSAGE_ID,
      sequence: 9,
    });
    expect(completeClient.rpc).toHaveBeenCalledWith(
      "complete_ai_hermes_broker_call",
      {
        p_organization_id: ORGANIZATION_ID,
        p_owner_user_id: USER_ID,
        p_broker_call_id: BROKER_CALL_ID,
        p_claim_owner_id: CLAIM_OWNER_ID,
        p_fencing_token: 7,
        p_status: "completed",
        p_sanitized_response_envelope: { status: "ok" },
        p_error_code: null,
        p_tool_content: "Sanitized tool result",
        p_tool_metadata: { toolCallId: "tool-call-1", truncated: false },
      },
    );
  });

  it("appends tool audit messages with actor-owned identity", async () => {
    const { client, rpc } = rpcClient({
      data: { message_id: MESSAGE_ID, sequence_no: 9 },
      error: null,
    });
    const repository = createHermesStateRepository(client);

    await repository.appendToolMessage(actor, TURN_ID, {
      content: "Tool completed",
      metadata: { toolName: "tool.alpha", status: "ok" },
    });

    expect(rpc).toHaveBeenCalledWith("append_ai_hermes_tool_message", {
      p_organization_id: ORGANIZATION_ID,
      p_owner_user_id: USER_ID,
      p_conversation_id: CONVERSATION_ID,
      p_turn_id: TURN_ID,
      p_invocation_id: INVOCATION_ID,
      p_content: "Tool completed",
      p_metadata: { toolName: "tool.alpha", status: "ok" },
    });
  });

  it("loads only active memories for the actor owner", async () => {
    const query = memoryQuery({
      data: [
        {
          id: MEMORY_ID,
          memory_key: MEMORY_KEY,
          memory_type: "preference",
          content: "Prefer concise answers",
          content_hash: "e".repeat(64),
          revision: 2,
          source_conversation_id: CONVERSATION_ID,
          source_message_id: MESSAGE_ID,
          source_invocation_id: INVOCATION_ID,
          created_at: "2026-07-22T05:00:00.000Z",
          updated_at: "2026-07-22T05:01:00.000Z",
        },
      ],
      error: null,
    });
    const from = vi.fn(() => query.builder);
    const client = {
      from,
      rpc: vi.fn(),
    } as unknown as HermesStateRepositoryClient;

    await expect(
      createHermesStateRepository(client).loadActiveMemories(actor),
    ).resolves.toEqual([
      expect.objectContaining({
        id: MEMORY_ID,
        memoryKey: MEMORY_KEY,
        memoryType: "preference",
        revision: 2,
      }),
    ]);
    expect(from).toHaveBeenCalledWith("ai_hermes_memories");
    expect(query.select).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenNthCalledWith(
      1,
      "organization_id",
      ORGANIZATION_ID,
    );
    expect(query.eq).toHaveBeenNthCalledWith(2, "owner_user_id", USER_ID);
    expect(query.eq).toHaveBeenNthCalledWith(3, "active", true);
    expect(query.order).toHaveBeenCalledWith("updated_at", {
      ascending: false,
    });
  });

  it("writes memory and Skill proposals without accepting payload identity", async () => {
    const memoryClient = rpcClient({
      data: {
        memory_id: MEMORY_ID,
        memory_key: MEMORY_KEY,
        revision: 1,
        active: true,
        reused: false,
      },
      error: null,
    });
    const memoryRepository = createHermesStateRepository(memoryClient.client);
    const memoryProposal = {
      idempotencyKey: "memory-request-1",
      memoryKey: null,
      expectedRevision: 0,
      memoryType: "preference" as const,
      content: "Prefer concise answers",
      active: true,
      sourceMessageId: MESSAGE_ID,
      organizationId: "attacker-org",
      userId: "attacker-user",
    };
    await memoryRepository.writeMemoryRevision(actor, memoryProposal);
    expect(memoryClient.rpc).toHaveBeenCalledWith(
      "write_ai_hermes_memory_revision",
      {
        p_organization_id: ORGANIZATION_ID,
        p_owner_user_id: USER_ID,
        p_idempotency_key: "memory-request-1",
        p_memory_key: null,
        p_expected_revision: 0,
        p_memory_type: "preference",
        p_content: "Prefer concise answers",
        p_content_hash: sha256("Prefer concise answers"),
        p_active: true,
        p_source_conversation_id: CONVERSATION_ID,
        p_source_message_id: MESSAGE_ID,
        p_source_invocation_id: INVOCATION_ID,
      },
    );

    const skillClient = rpcClient({
      data: { draft_id: DRAFT_ID, status: "draft", reused: false },
      error: null,
    });
    const skillRepository = createHermesStateRepository(skillClient.client);
    await skillRepository.upsertSkillDraft(actor, {
      skillId: "risk_review",
      version: 1,
      manifest: { name: "Risk review" },
      bundle: "skill bundle",
    });
    expect(skillClient.rpc).toHaveBeenCalledWith(
      "write_ai_hermes_skill_draft",
      {
        p_organization_id: ORGANIZATION_ID,
        p_owner_user_id: USER_ID,
        p_skill_id: "risk_review",
        p_version: 1,
        p_manifest: { name: "Risk review" },
        p_bundle: "skill bundle",
        p_bundle_sha256: sha256("skill bundle"),
        p_source_conversation_id: CONVERSATION_ID,
        p_source_invocation_id: INVOCATION_ID,
      },
    );
  });

  it("reviews drafts with a public key id while ignoring signing private keys", async () => {
    const { client, rpc, calls } = rpcClient({
      data: { draft_id: DRAFT_ID, status: "approved" },
      error: null,
    });
    const repository = createHermesStateRepository(client);
    const command = {
      draftId: DRAFT_ID,
      nextStatus: "approved" as const,
      reviewNote: "Approved",
      signature: "detached-signature",
      signingKeyId: "skill-key-2026-07",
      privateKey: "signing-private-key-secret",
    };

    await repository.reviewSkillDraft(actor, command);

    expect(rpc).toHaveBeenCalledWith("review_ai_hermes_skill_draft", {
      p_organization_id: ORGANIZATION_ID,
      p_owner_user_id: USER_ID,
      p_draft_id: DRAFT_ID,
      p_reviewer_user_id: USER_ID,
      p_next_status: "approved",
      p_review_note: "Approved",
      p_signature: "detached-signature",
      p_signing_key_id: "skill-key-2026-07",
    });
    expect(JSON.stringify(calls)).not.toContain("signing-private-key-secret");
  });

  it("uses exact provider-state, cancel, renew, and v2 finish RPCs", async () => {
    const stateClient = rpcClient({ data: { generation: 4 }, error: null });
    await createHermesStateRepository(
      stateClient.client,
    ).compareAndSwapGatewayState(actor, CONVERSATION_ID, 3, {
      generation: 4,
      sessionId: "gateway-session-1",
    });
    expect(stateClient.rpc).toHaveBeenCalledWith(
      "update_ai_conversation_hermes_state",
      {
        p_organization_id: ORGANIZATION_ID,
        p_owner_user_id: USER_ID,
        p_conversation_id: CONVERSATION_ID,
        p_expected_generation: 3,
        p_next_hermes_state: {
          generation: 4,
          sessionId: "gateway-session-1",
        },
      },
    );

    const cancelClient = rpcClient({
      data: {
        turn_id: TURN_ID,
        status: "cancelled",
        cancel_requested: true,
        already_terminal: false,
      },
      error: null,
    });
    await expect(
      createHermesStateRepository(cancelClient.client).cancelTurn(
        actor,
        CONVERSATION_ID,
        TURN_ID,
      ),
    ).resolves.toMatchObject({ status: "cancelled", cancelRequested: true });
    expect(cancelClient.rpc).toHaveBeenCalledWith("cancel_ai_chat_turn", {
      p_organization_id: ORGANIZATION_ID,
      p_owner_user_id: USER_ID,
      p_conversation_id: CONVERSATION_ID,
      p_turn_id: TURN_ID,
    });

    const renewClient = rpcClient({ data: true, error: null });
    await createHermesStateRepository(renewClient.client).renewTurnLease(
      actor,
      TURN_ID,
    );
    expect(renewClient.rpc).toHaveBeenCalledWith("renew_ai_chat_turn_lease", {
      p_organization_id: ORGANIZATION_ID,
      p_owner_user_id: USER_ID,
      p_turn_id: TURN_ID,
    });

    const finishClient = rpcClient({ data: true, error: null });
    await createHermesStateRepository(finishClient.client).finishTurn(
      actor,
      TURN_ID,
      {
        outcome: "partial",
        content: "Partial answer",
        providerName: "deepseek",
        errorCode: null,
        errorSummary: null,
        retryable: false,
        metadata: { missingData: ["settlement"] },
      },
    );
    expect(finishClient.rpc).toHaveBeenCalledWith("finish_ai_chat_turn_v2", {
      p_organization_id: ORGANIZATION_ID,
      p_owner_user_id: USER_ID,
      p_turn_id: TURN_ID,
      p_outcome: "partial",
      p_content: "Partial answer",
      p_provider_name: "deepseek",
      p_ai_invocation_id: INVOCATION_ID,
      p_error_code: null,
      p_error_summary: null,
      p_retryable: false,
      p_metadata: { missingData: ["settlement"] },
    });
  });

  it("rejects identity and secret fields inside model envelopes before Supabase", async () => {
    const { client, rpc } = rpcClient({ data: null, error: null });
    const repository = createHermesStateRepository(client);

    for (const forbidden of [
      "organizationId",
      "userId",
      "rawCapability",
      "privateKey",
      "actorAssertion",
    ]) {
      await expect(
        repository.claimBrokerCall(
          actor,
          TOKEN_SHA256,
          ACTOR_FINGERPRINT,
          CLAIM_OWNER_ID,
          `tool-call-${forbidden}`,
          "tool.alpha",
          REQUEST_SHA256,
          { [forbidden]: "secret" },
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "ACCESS_token",
    "refresh__token",
    "client_secret",
    "authorization_header",
    "bearer_token",
    "api_key",
    "api_token",
    "service_token",
    "session_token",
    "session_cookie",
    "db_password",
    "rsa_private_key",
    "client_secret_key",
    "actor_jws",
    "JWT",
  ])(
    "recursively rejects raw secret key %s on every persisted JSON surface",
    async (forbiddenKey) => {
      for (const payload of payloadShapes(forbiddenKey, "raw-secret")) {
        for (const operation of persistedJsonOperations(payload)) {
          const { client, rpc } = rpcClient({ data: null, error: null });
          await expect(
            operation(createHermesStateRepository(client)),
          ).rejects.toMatchObject({ code: "invalid_input" });
          expect(rpc).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each([
    ["authorizationHash", "Bearer raw"],
    ["token_sha256", "a".repeat(63)],
    ["capabilityHash", "z".repeat(64)],
    ["api_key_hash", { raw: "secret" }],
  ])(
    "rejects non-SHA-256 value on digest-labeled key %s",
    async (digestKey, invalidDigest) => {
      for (const payload of payloadShapes(digestKey, invalidDigest)) {
        for (const operation of persistedJsonOperations(payload)) {
          const { client, rpc } = rpcClient({ data: null, error: null });
          await expect(
            operation(createHermesStateRepository(client)),
          ).rejects.toMatchObject({ code: "invalid_input" });
          expect(rpc).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects prototype-control key %s at every persisted JSON depth",
    async (controlKey) => {
      for (const payload of payloadShapes(controlKey, { polluted: true })) {
        for (const operation of persistedJsonOperations(payload)) {
          const { client, rpc } = rpcClient({ data: null, error: null });
          await expect(
            operation(createHermesStateRepository(client)),
          ).rejects.toMatchObject({ code: "invalid_input" });
          expect(rpc).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(["access_token", "__proto__", "prototype", "constructor"])(
    "rejects dangerous own array property %s instead of silently dropping it",
    async (dangerousKey) => {
      const items: unknown[] = [{ safe: true }];
      Object.defineProperty(items, dangerousKey, {
        value: "attack",
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const { client, rpc } = rpcClient({ data: null, error: null });

      await expect(
        createHermesStateRepository(client).appendToolMessage(actor, TURN_ID, {
          content: "Tool completed",
          metadata: { items },
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("fails closed on an own __proto__ property produced by JSON.parse", async () => {
    const payload: Record<string, unknown> = JSON.parse(
      '{"__proto__":{"polluted":true}}',
    );
    const { client, rpc } = rpcClient({ data: null, error: null });

    await expect(
      createHermesStateRepository(client).claimBrokerCall(
        actor,
        TOKEN_SHA256,
        ACTOR_FINGERPRINT,
        CLAIM_OWNER_ID,
        "tool-call-prototype",
        "tool.alpha",
        REQUEST_SHA256,
        payload,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("allows explicit secret hashes in sanitized envelopes", async () => {
    const { client, rpc } = rpcClient({
      data: {
        broker_call_id: BROKER_CALL_ID,
        status: "claimed",
        execute: true,
        reused: false,
        fencing_token: 1,
        sanitized_response_envelope: null,
      },
      error: null,
    });
    const hashes = {
      jwtSha256: "1".repeat(64),
      api_key_hash: "2".repeat(64),
      serviceTokenSha256: "3".repeat(64),
      token_sha256: "4".repeat(64),
      capabilityHash: "5".repeat(64),
    };

    await createHermesStateRepository(client).claimBrokerCall(
      actor,
      TOKEN_SHA256,
      ACTOR_FINGERPRINT,
      CLAIM_OWNER_ID,
      "tool-call-hashes",
      "tool.alpha",
      REQUEST_SHA256,
      { hashes },
    );

    expect(rpc).toHaveBeenCalledWith(
      "claim_ai_hermes_broker_call",
      expect.objectContaining({ p_sanitized_request_envelope: { hashes } }),
    );
  });

  it("returns a plain own-property copy for benign sanitized payloads", () => {
    const source = { nested: [{ safe: true }] };
    const copy = assertHermesSanitizedObject(source);

    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect("polluted" in copy).toBe(false);
  });

  it.each(["organizationId", "userId", "conversationId", "invocationId"])(
    "rejects a non-UUID actor %s at the repository boundary",
    async (field) => {
      const invalidActor = { ...actor, [field]: "not-a-uuid" };
      const { client, rpc } = rpcClient({ data: null, error: null });

      await expect(
        createHermesStateRepository(client).appendToolMessage(
          invalidActor,
          TURN_ID,
          { content: "Tool completed" },
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "capability_id",
      data: {
        capability_id: "not-a-uuid",
        expires_at: "2026-07-22T05:05:00.000Z",
      },
      invoke: (repository: HermesStateRepository) =>
        repository.issueRunCapability(
          actorSnapshot,
          { id: TURN_ID, conversationId: CONVERSATION_ID },
          capabilityBinding,
          new Date("2026-07-22T05:05:00.000Z"),
        ),
    },
    {
      name: "broker_call_id from claim",
      data: {
        broker_call_id: "not-a-uuid",
        status: "claimed",
        execute: true,
        reused: false,
        fencing_token: 1,
        sanitized_response_envelope: null,
      },
      invoke: (repository: HermesStateRepository) =>
        repository.claimBrokerCall(
          actor,
          TOKEN_SHA256,
          ACTOR_FINGERPRINT,
          CLAIM_OWNER_ID,
          "tool-call-invalid-id",
          "tool.alpha",
          REQUEST_SHA256,
          {},
        ),
    },
    {
      name: "broker_call_id from completion",
      data: {
        broker_call_id: "not-a-uuid",
        status: "completed",
        reused: false,
        fencing_token: 1,
      },
      invoke: (repository: HermesStateRepository) =>
        repository.completeBrokerCall(
          actor,
          BROKER_CALL_ID,
          CLAIM_OWNER_ID,
          1,
          "completed",
          {},
          { content: "Tool completed", metadata: {} },
        ),
    },
    {
      name: "message_id",
      data: { message_id: "not-a-uuid", sequence_no: 1 },
      invoke: (repository: HermesStateRepository) =>
        repository.appendToolMessage(actor, TURN_ID, {
          content: "Tool completed",
        }),
    },
    {
      name: "memory_id",
      data: {
        memory_id: "not-a-uuid",
        memory_key: MEMORY_KEY,
        revision: 1,
        active: true,
        reused: false,
      },
      invoke: (repository: HermesStateRepository) =>
        repository.writeMemoryRevision(actor, {
          idempotencyKey: "memory-invalid-id",
          memoryKey: null,
          expectedRevision: 0,
          memoryType: "preference",
          content: "Remember this",
          active: true,
          sourceMessageId: MESSAGE_ID,
        }),
    },
    {
      name: "memory_key",
      data: {
        memory_id: MEMORY_ID,
        memory_key: "not-a-uuid",
        revision: 1,
        active: true,
        reused: false,
      },
      invoke: (repository: HermesStateRepository) =>
        repository.writeMemoryRevision(actor, {
          idempotencyKey: "memory-invalid-key",
          memoryKey: null,
          expectedRevision: 0,
          memoryType: "preference",
          content: "Remember this",
          active: true,
          sourceMessageId: MESSAGE_ID,
        }),
    },
    {
      name: "draft_id from write",
      data: { draft_id: "not-a-uuid", status: "draft", reused: false },
      invoke: (repository: HermesStateRepository) =>
        repository.upsertSkillDraft(actor, {
          skillId: "risk_review",
          version: 1,
          manifest: {},
          bundle: "skill bundle",
        }),
    },
    {
      name: "draft_id from review",
      data: { draft_id: "not-a-uuid", status: "approved" },
      invoke: (repository: HermesStateRepository) =>
        repository.reviewSkillDraft(actor, {
          draftId: DRAFT_ID,
          nextStatus: "approved",
          signature: "signature",
          signingKeyId: "public-key-id",
        }),
    },
    {
      name: "turn_id",
      data: {
        turn_id: "not-a-uuid",
        status: "cancelled",
        cancel_requested: true,
        already_terminal: false,
      },
      invoke: (repository: HermesStateRepository) =>
        repository.cancelTurn(actor, CONVERSATION_ID, TURN_ID),
    },
  ])(
    "fails closed on malformed success UUID $name",
    async ({ data, invoke }) => {
      const { client } = rpcClient({ data, error: null });
      await expect(
        invoke(createHermesStateRepository(client)),
      ).rejects.toMatchObject({ code: "state_conflict" });
    },
  );

  it.each(["2026-07-22", "2026-02-30T05:05:00.000Z", "not-an-iso-date"])(
    "fails closed on malformed success timestamp %s",
    async (expiresAt) => {
      const { client } = rpcClient({
        data: { capability_id: CAPABILITY_ID, expires_at: expiresAt },
        error: null,
      });

      await expect(
        createHermesStateRepository(client).issueRunCapability(
          actorSnapshot,
          { id: TURN_ID, conversationId: CONVERSATION_ID },
          capabilityBinding,
          new Date("2026-07-22T05:05:00.000Z"),
        ),
      ).rejects.toMatchObject({ code: "state_conflict" });
    },
  );

  it.each([
    "id",
    "memory_key",
    "source_conversation_id",
    "source_message_id",
    "source_invocation_id",
  ])("fails closed on malformed loaded memory UUID %s", async (field) => {
    const row = {
      id: MEMORY_ID,
      memory_key: MEMORY_KEY,
      memory_type: "preference",
      content: "Prefer concise answers",
      content_hash: "e".repeat(64),
      revision: 2,
      source_conversation_id: CONVERSATION_ID,
      source_message_id: MESSAGE_ID,
      source_invocation_id: INVOCATION_ID,
      created_at: "2026-07-22T05:00:00.000Z",
      updated_at: "2026-07-22T05:01:00.000Z",
      [field]: "not-a-uuid",
    };
    const query = memoryQuery({ data: [row], error: null });
    const client = {
      from: vi.fn(() => query.builder),
      rpc: vi.fn(),
    } as unknown as HermesStateRepositoryClient;

    await expect(
      createHermesStateRepository(client).loadActiveMemories(actor),
    ).rejects.toMatchObject({ code: "state_conflict" });
  });

  it.each([
    ["skill_draft_not_found", "not_found"],
    ["skill_reviewer_not_authorized", "permission_denied"],
    ["memory_idempotency_conflict", "idempotency_conflict"],
    ["turn_lease_invalid", "lease_expired"],
    ["hermes_state_conflict", "state_conflict"],
    ["memory_revision_invalid", "invalid_input"],
    ["capability_parallel_limit_extra", "state_conflict"],
    ["relation public.ai_hermes_memories does not exist", "state_conflict"],
  ] as const)("maps %s to stable error %s", async (message, code) => {
    const { client } = rpcClient({ data: null, error: { message } });
    const repository = createHermesStateRepository(client);

    const error = await repository
      .cancelTurn(actor, CONVERSATION_ID, TURN_ID)
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(HermesStateRepositoryError);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(message);
  });

  it("maps only an atomic capability parallel-limit rejection to parallel_limit", async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: "P0001", message: "capability_parallel_limit" },
    });

    const error = await createHermesStateRepository(client)
      .issueRunCapability(
        actorSnapshot,
        { id: TURN_ID, conversationId: CONVERSATION_ID },
        capabilityBinding,
        new Date("2026-07-22T05:05:00.000Z"),
      )
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(HermesStateRepositoryError);
    expect(error).toMatchObject({ code: "parallel_limit" });
    expect(String(error)).not.toContain("capability_parallel_limit");
  });

  it("fails closed when an RPC succeeds with malformed data", async () => {
    const { client } = rpcClient({
      data: { status: "claimed", execute: true },
      error: null,
    });

    await expect(
      createHermesStateRepository(client).claimBrokerCall(
        actor,
        TOKEN_SHA256,
        ACTOR_FINGERPRINT,
        CLAIM_OWNER_ID,
        "tool-call-1",
        "tool.alpha",
        REQUEST_SHA256,
        {},
      ),
    ).rejects.toMatchObject({ code: "state_conflict" });
  });
});

function rpcClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return result;
  });
  const client = {
    from: vi.fn(),
    rpc,
  } as unknown as HermesStateRepositoryClient;
  return { calls, client, rpc };
}

function memoryQuery(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const builder: Record<string, unknown> = {};
  const select = vi.fn(() => builder);
  const eq = vi.fn(() => builder);
  Object.assign(builder, { eq, order, select });
  return { builder, eq, order, select };
}

function postgresArrayHash(values: string[]): string {
  return sha256(`[${values.map((value) => JSON.stringify(value)).join(", ")}]`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
