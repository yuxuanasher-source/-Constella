import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const LIVE_ENABLED =
  process.env.RUN_HERMES_CAPABILITY_PARALLELISM_LIVE === "1" &&
  Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Hermes capability parallelism", () => {
  it.runIf(LIVE_ENABLED)(
    "enforces mode depth and reuses run-wide slots after child completion",
    async () => {
      const client = createLiveClient();
      const suffix = randomUUID();
      const email = `hermes-capability-${suffix}@example.test`;
      let userId: string | null = null;
      let organizationId: string | null = null;

      try {
        const createdUser = await client.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        expect(createdUser.error).toBeNull();
        userId = createdUser.data.user?.id ?? null;
        if (!userId) throw new Error("live fixture user was not created");

        const organization = await client
          .from("organizations")
          .insert({
            name: `Hermes Capability ${suffix}`,
            code: `hermes-cap-${suffix}`,
          })
          .select("id")
          .single();
        expect(organization.error).toBeNull();
        organizationId = organization.data?.id ?? null;
        if (!organizationId) {
          throw new Error("live fixture organization was not created");
        }

        const profile = await client.from("profiles").insert({
          id: userId,
          email,
          full_name: "Hermes Capability Test",
        });
        expect(profile.error).toBeNull();

        await assertRunWideModeLimit(client, {
          organizationId,
          userId,
          suffix,
          mode: "fast",
        });
        await assertRunWideModeLimit(client, {
          organizationId,
          userId,
          suffix,
          mode: "deep",
        });
      } finally {
        if (organizationId) {
          await client.from("organizations").delete().eq("id", organizationId);
        }
        if (userId) {
          await client.from("profiles").delete().eq("id", userId);
          await client.auth.admin.deleteUser(userId);
        }
      }
    },
    30_000,
  );
});

async function assertRunWideModeLimit(
  client: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    suffix: string;
    mode: "fast" | "deep";
  },
): Promise<void> {
  const conversation = await client
    .from("ai_conversations")
    .insert({
      organization_id: input.organizationId,
      owner_user_id: input.userId,
      title: `Hermes ${input.mode} parallelism`,
    })
    .select("id")
    .single();
  expect(conversation.error).toBeNull();
  const conversationId = conversation.data?.id;
  if (!conversationId)
    throw new Error("live fixture conversation was not created");

  const turn = await client.rpc("create_ai_chat_turn", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_conversation_id: conversationId,
    p_idempotency_key: `hermes-${input.mode}-${input.suffix}`,
    p_mode: input.mode,
    p_kind: "user",
    p_content: "Verify atomic Hermes capability issuance.",
    p_source_turn_id: null,
  });
  expect(turn.error).toBeNull();
  const turnId = recordString(turn.data, "turn_id");
  const rootInvocationId = randomUUID();
  const seedInvocationId = randomUUID();
  const depthTwoInvocationId = input.mode === "deep" ? randomUUID() : null;
  const overDepthInvocationId = randomUUID();
  const replacementInvocationId = randomUUID();
  const staleDerivationInvocationId = randomUUID();
  const attemptedChildren = input.mode === "fast" ? 2 : 4;
  const childInvocationIds = Array.from({ length: attemptedChildren }, () =>
    randomUUID(),
  );
  const allInvocationIds = [
    rootInvocationId,
    seedInvocationId,
    ...(depthTwoInvocationId ? [depthTwoInvocationId] : []),
    overDepthInvocationId,
    replacementInvocationId,
    staleDerivationInvocationId,
    ...childInvocationIds,
  ];
  const invocations = await client.from("ai_invocations").insert(
    allInvocationIds.map((id) => ({
      id,
      organization_id: input.organizationId,
      actor_user_id: input.userId,
      actor_role: "owner",
      scene: "hermes_capability_parallelism_test",
    })),
  );
  expect(invocations.error).toBeNull();

  const rootTokenSha256 = sha256(`root:${input.mode}:${input.suffix}`);
  const actorFingerprint = sha256(`actor:${input.mode}:${input.suffix}`);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const emptyArrayHash = postgresArrayHash([]);
  const root = await client.rpc("issue_ai_hermes_run_capability", {
    p_token_sha256: rootTokenSha256,
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_conversation_id: conversationId,
    p_turn_id: turnId,
    p_invocation_id: rootInvocationId,
    p_parent_invocation_id: null,
    p_parent_token_sha256: null,
    p_actor_fingerprint: actorFingerprint,
    p_allowed_tools: [],
    p_allowed_tools_hash: emptyArrayHash,
    p_scopes: [],
    p_scope_hash: emptyArrayHash,
    p_skill_grants_hash: emptyArrayHash,
    p_skill_draft_ids: [],
    p_depth: 0,
    p_ai_state_writes_allowed: false,
    p_expires_at: expiresAt,
  });
  expect(root.error).toBeNull();

  const seedTokenSha256 = sha256(`seed:${input.mode}:${input.suffix}`);
  const seed = await issueCapability(client, {
    tokenSha256: seedTokenSha256,
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId,
    turnId,
    invocationId: seedInvocationId,
    parentInvocationId: rootInvocationId,
    parentTokenSha256: rootTokenSha256,
    actorFingerprint,
    depth: 1,
    expiresAt,
    emptyArrayHash,
  });
  expect(seed.error).toBeNull();

  let deepestParentInvocationId = seedInvocationId;
  let deepestParentTokenSha256 = seedTokenSha256;
  if (input.mode === "deep" && depthTwoInvocationId) {
    const depthTwoTokenSha256 = sha256(`depth-two:${input.suffix}`);
    const depthTwo = await issueCapability(client, {
      tokenSha256: depthTwoTokenSha256,
      organizationId: input.organizationId,
      userId: input.userId,
      conversationId,
      turnId,
      invocationId: depthTwoInvocationId,
      parentInvocationId: seedInvocationId,
      parentTokenSha256: seedTokenSha256,
      actorFingerprint,
      depth: 2,
      expiresAt,
      emptyArrayHash,
    });
    expect(depthTwo.error).toBeNull();
    deepestParentInvocationId = depthTwoInvocationId;
    deepestParentTokenSha256 = depthTwoTokenSha256;
  }

  const overDepth = await issueCapability(client, {
    tokenSha256: sha256(`over-depth:${input.mode}:${input.suffix}`),
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId,
    turnId,
    invocationId: overDepthInvocationId,
    parentInvocationId: deepestParentInvocationId,
    parentTokenSha256: deepestParentTokenSha256,
    actorFingerprint,
    depth: input.mode === "fast" ? 2 : 3,
    expiresAt,
    emptyArrayHash,
  });
  expect(overDepth.error?.message).toContain("capability_depth_limit");

  const attempts = childInvocationIds.map((childInvocationId, index) => {
    const deriveFromSeed = input.mode === "deep" && index >= 2;
    return {
      childInvocationId,
      parentInvocationId: deriveFromSeed ? seedInvocationId : rootInvocationId,
      parentTokenSha256: deriveFromSeed ? seedTokenSha256 : rootTokenSha256,
      depth: deriveFromSeed ? 2 : 1,
    };
  });

  const results = await withTimeout(
    Promise.all(
      attempts.map((attempt, index) =>
        issueCapability(client, {
          tokenSha256: sha256(`child:${input.mode}:${input.suffix}:${index}`),
          organizationId: input.organizationId,
          userId: input.userId,
          conversationId,
          turnId,
          invocationId: attempt.childInvocationId,
          parentInvocationId: attempt.parentInvocationId,
          parentTokenSha256: attempt.parentTokenSha256,
          actorFingerprint,
          depth: attempt.depth,
          expiresAt,
          emptyArrayHash,
        }),
      ),
    ),
    10_000,
  );

  const successes = results.filter((result) => result.error === null);
  const failures = results.filter((result) => result.error !== null);
  const expectedSuccesses = input.mode === "fast" ? 0 : 1;
  const expectedActiveSubagents = input.mode === "fast" ? 1 : 3;
  expect(successes).toHaveLength(expectedSuccesses);
  expect(failures).toHaveLength(attemptedChildren - expectedSuccesses);
  for (const failure of failures) {
    expect(failure.error?.message).toContain("capability_parallel_limit");
  }

  await expect(countActiveSubagents(client, turnId)).resolves.toBe(
    expectedActiveSubagents,
  );

  const terminalStatus = input.mode === "fast" ? "succeeded" : "failed";
  const completion = await client
    .from("ai_invocations")
    .update({
      status: terminalStatus,
      completed_at: new Date().toISOString(),
    })
    .eq("id", seedInvocationId)
    .eq("organization_id", input.organizationId)
    .eq("actor_user_id", input.userId);
  expect(completion.error).toBeNull();

  const terminalCapabilities = await client
    .from("ai_hermes_run_capabilities")
    .select("token_sha256, revoked_at")
    .in("token_sha256", [rootTokenSha256, seedTokenSha256]);
  expect(terminalCapabilities.error).toBeNull();
  const rootCapability = terminalCapabilities.data?.find(
    (capability) => capability.token_sha256 === rootTokenSha256,
  );
  const seedCapability = terminalCapabilities.data?.find(
    (capability) => capability.token_sha256 === seedTokenSha256,
  );
  expect(rootCapability?.revoked_at).toBeNull();
  expect(seedCapability?.revoked_at).toEqual(expect.any(String));

  const simulateDelayedRevocation = await client
    .from("ai_hermes_run_capabilities")
    .update({ revoked_at: null })
    .eq("token_sha256", seedTokenSha256)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.userId);
  expect(simulateDelayedRevocation.error).toBeNull();

  const staleBrokerClaim = await client.rpc("claim_ai_hermes_broker_call", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_token_sha256: seedTokenSha256,
    p_actor_fingerprint: actorFingerprint,
    p_claim_owner_id: randomUUID(),
    p_tool_call_id: `stale-${input.mode}-${input.suffix}`,
    p_tool_name: "xingyao_search_projects",
    p_request_sha256: sha256(`stale-request:${input.mode}:${input.suffix}`),
    p_sanitized_request_envelope: {},
  });
  expect(staleBrokerClaim.error?.message).toContain("capability_invalid");

  const staleDerivation = await issueCapability(client, {
    tokenSha256: sha256(`stale-child:${input.mode}:${input.suffix}`),
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId,
    turnId,
    invocationId: staleDerivationInvocationId,
    parentInvocationId: seedInvocationId,
    parentTokenSha256: seedTokenSha256,
    actorFingerprint,
    depth: 2,
    expiresAt,
    emptyArrayHash,
  });
  expect(staleDerivation.error?.message).toContain(
    input.mode === "fast"
      ? "capability_depth_limit"
      : "capability_parent_invalid",
  );

  const replacement = await issueCapability(client, {
    tokenSha256: sha256(`replacement:${input.mode}:${input.suffix}`),
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId,
    turnId,
    invocationId: replacementInvocationId,
    parentInvocationId: rootInvocationId,
    parentTokenSha256: rootTokenSha256,
    actorFingerprint,
    depth: 1,
    expiresAt,
    emptyArrayHash,
  });
  expect(replacement.error).toBeNull();

  const restoreRevocation = await client
    .from("ai_hermes_run_capabilities")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_sha256", seedTokenSha256)
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.userId);
  expect(restoreRevocation.error).toBeNull();
  await expect(countActiveSubagents(client, turnId)).resolves.toBe(
    expectedActiveSubagents,
  );
}

async function countActiveSubagents(
  client: SupabaseClient,
  turnId: string,
): Promise<number> {
  const capabilities = await client
    .from("ai_hermes_run_capabilities")
    .select("invocation_id")
    .eq("turn_id", turnId)
    .gt("depth", 0)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  expect(capabilities.error).toBeNull();
  const invocationIds = (capabilities.data ?? []).map(
    (capability) => capability.invocation_id,
  );
  if (invocationIds.length === 0) return 0;

  const invocations = await client
    .from("ai_invocations")
    .select("id, status")
    .in("id", invocationIds);
  expect(invocations.error).toBeNull();
  return (invocations.data ?? []).filter((invocation) =>
    ["started", "queued"].includes(invocation.status),
  ).length;
}

function issueCapability(
  client: SupabaseClient,
  input: {
    tokenSha256: string;
    organizationId: string;
    userId: string;
    conversationId: string;
    turnId: string;
    invocationId: string;
    parentInvocationId: string;
    parentTokenSha256: string;
    actorFingerprint: string;
    depth: number;
    expiresAt: string;
    emptyArrayHash: string;
  },
) {
  return client.rpc("issue_ai_hermes_run_capability", {
    p_token_sha256: input.tokenSha256,
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_turn_id: input.turnId,
    p_invocation_id: input.invocationId,
    p_parent_invocation_id: input.parentInvocationId,
    p_parent_token_sha256: input.parentTokenSha256,
    p_actor_fingerprint: input.actorFingerprint,
    p_allowed_tools: [],
    p_allowed_tools_hash: input.emptyArrayHash,
    p_scopes: [],
    p_scope_hash: input.emptyArrayHash,
    p_skill_grants_hash: input.emptyArrayHash,
    p_skill_draft_ids: [],
    p_depth: input.depth,
    p_ai_state_writes_allowed: false,
    p_expires_at: input.expiresAt,
  });
}

function createLiveClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function recordString(value: unknown, key: string): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !(key in value) ||
    typeof value[key as keyof typeof value] !== "string"
  ) {
    throw new Error(`live RPC did not return ${key}`);
  }
  return value[key as keyof typeof value] as string;
}

function postgresArrayHash(values: string[]): string {
  return sha256(`[${values.map((value) => JSON.stringify(value)).join(", ")}]`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("live capability issuance timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
