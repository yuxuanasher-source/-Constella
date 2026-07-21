import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const LIVE_ENABLED =
  process.env.RUN_HERMES_CAPABILITY_PARALLELISM_LIVE === "1" &&
  Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Hermes capability parallelism", () => {
  it.runIf(LIVE_ENABLED)(
    "atomically caps concurrent descendants across different parents per turn",
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
  const attemptedChildren = input.mode === "fast" ? 2 : 4;
  const childInvocationIds = Array.from({ length: attemptedChildren }, () =>
    randomUUID(),
  );
  const invocations = await client.from("ai_invocations").insert(
    [rootInvocationId, seedInvocationId, ...childInvocationIds].map((id) => ({
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

  const attempts = childInvocationIds.map((childInvocationId, index) => {
    const deriveFromSeed = input.mode === "fast" ? index === 1 : index >= 2;
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
  const expectedSuccesses = input.mode === "fast" ? 0 : 2;
  const expectedActiveSubagents = input.mode === "fast" ? 1 : 3;
  expect(successes).toHaveLength(expectedSuccesses);
  expect(failures).toHaveLength(attemptedChildren - expectedSuccesses);
  for (const failure of failures) {
    expect(failure.error?.message).toContain("capability_parallel_limit");
  }

  const activeSubagents = await client
    .from("ai_hermes_run_capabilities")
    .select("id", { count: "exact", head: true })
    .eq("turn_id", turnId)
    .gt("depth", 0)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  expect(activeSubagents.error).toBeNull();
  expect(activeSubagents.count).toBe(expectedActiveSubagents);
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
