import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const LIVE_ENABLED =
  process.env.RUN_HERMES_CAPABILITY_PARALLELISM_LIVE === "1" &&
  Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Hermes capability parallelism", () => {
  it.runIf(LIVE_ENABLED)(
    "atomically caps concurrent direct children for Fast and Deep turns",
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

        await assertModeLimit(client, {
          organizationId,
          userId,
          suffix,
          mode: "fast",
          attemptedChildren: 2,
          expectedSuccesses: 1,
        });
        await assertModeLimit(client, {
          organizationId,
          userId,
          suffix,
          mode: "deep",
          attemptedChildren: 4,
          expectedSuccesses: 3,
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

async function assertModeLimit(
  client: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    suffix: string;
    mode: "fast" | "deep";
    attemptedChildren: number;
    expectedSuccesses: number;
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
  const childInvocationIds = Array.from(
    { length: input.attemptedChildren },
    () => randomUUID(),
  );
  const invocations = await client.from("ai_invocations").insert(
    [rootInvocationId, ...childInvocationIds].map((id) => ({
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

  const results = await withTimeout(
    Promise.all(
      childInvocationIds.map((childInvocationId, index) =>
        client.rpc("issue_ai_hermes_run_capability", {
          p_token_sha256: sha256(
            `child:${input.mode}:${input.suffix}:${index}`,
          ),
          p_organization_id: input.organizationId,
          p_owner_user_id: input.userId,
          p_conversation_id: conversationId,
          p_turn_id: turnId,
          p_invocation_id: childInvocationId,
          p_parent_invocation_id: rootInvocationId,
          p_parent_token_sha256: rootTokenSha256,
          p_actor_fingerprint: actorFingerprint,
          p_allowed_tools: [],
          p_allowed_tools_hash: emptyArrayHash,
          p_scopes: [],
          p_scope_hash: emptyArrayHash,
          p_skill_grants_hash: emptyArrayHash,
          p_skill_draft_ids: [],
          p_depth: 1,
          p_ai_state_writes_allowed: false,
          p_expires_at: expiresAt,
        }),
      ),
    ),
    10_000,
  );

  const successes = results.filter((result) => result.error === null);
  const failures = results.filter((result) => result.error !== null);
  expect(successes).toHaveLength(input.expectedSuccesses);
  expect(failures).toHaveLength(
    input.attemptedChildren - input.expectedSuccesses,
  );
  for (const failure of failures) {
    expect(failure.error?.message).toContain("capability_parallel_limit");
  }
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
