import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const LIVE_ENABLED =
  process.env.RUN_HERMES_MEMORY_LIVE === "1" &&
  Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Hermes actor-private memory", () => {
  it.runIf(LIVE_ENABLED)(
    "serializes retries, preserves revisions, and rejects invalid authority",
    async () => {
      const client = createLiveClient();
      const suffix = randomUUID();
      const email = `hermes-memory-${suffix}@example.test`;
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
            name: `Hermes Memory ${suffix}`,
            code: `hermes-memory-${suffix}`,
          })
          .select("id")
          .single();
        expect(organization.error).toBeNull();
        organizationId = organization.data?.id ?? null;
        if (!organizationId) {
          throw new Error("live fixture organization was not created");
        }

        expect(
          (
            await client.from("profiles").insert({
              id: userId,
              email,
              full_name: "Hermes Memory Test",
            })
          ).error,
        ).toBeNull();

        const conversation = await client
          .from("ai_conversations")
          .insert({
            organization_id: organizationId,
            owner_user_id: userId,
            title: "Hermes memory concurrency",
          })
          .select("id")
          .single();
        expect(conversation.error).toBeNull();
        const conversationId = conversation.data?.id;
        if (!conversationId) throw new Error("conversation was not created");

        const turn = await client.rpc("create_ai_chat_turn", {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_conversation_id: conversationId,
          p_idempotency_key: `hermes-memory-${suffix}`,
          p_mode: "fast",
          p_kind: "user",
          p_content: "Remember my communication preference.",
          p_source_turn_id: null,
        });
        expect(turn.error).toBeNull();
        const turnId = recordString(turn.data, "turn_id");
        const sourceMessageId = recordString(turn.data, "user_message_id");
        const assistantMessageId = recordString(
          turn.data,
          "assistant_message_id",
        );
        const invocationId = randomUUID();
        const childInvocationId = randomUUID();
        expect(
          (
            await client.from("ai_invocations").insert([
              {
                id: invocationId,
                organization_id: organizationId,
                actor_user_id: userId,
                actor_role: "owner",
                scene: "hermes_memory_live_test",
              },
              {
                id: childInvocationId,
                organization_id: organizationId,
                actor_user_id: userId,
                actor_role: "owner",
                scene: "hermes_memory_live_test_child",
              },
            ])
          ).error,
        ).toBeNull();

        const actorFingerprint = sha256(`actor:${suffix}`);
        const rootTokenSha256 = sha256(`root:${suffix}`);
        const childTokenSha256 = sha256(`child:${suffix}`);
        const allowedTools = [
          "xingyao_memory_forget",
          "xingyao_memory_remember",
        ];
        const emptyHash = postgresArrayHash([]);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        const root = await client.rpc("issue_ai_hermes_run_capability", {
          p_token_sha256: rootTokenSha256,
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_conversation_id: conversationId,
          p_turn_id: turnId,
          p_invocation_id: invocationId,
          p_parent_invocation_id: null,
          p_parent_token_sha256: null,
          p_actor_fingerprint: actorFingerprint,
          p_allowed_tools: allowedTools,
          p_allowed_tools_hash: postgresArrayHash(allowedTools),
          p_scopes: [],
          p_scope_hash: emptyHash,
          p_skill_grants_hash: emptyHash,
          p_skill_draft_ids: [],
          p_depth: 0,
          p_ai_state_writes_allowed: true,
          p_expires_at: expiresAt,
        });
        expect(root.error).toBeNull();

        const child = await client.rpc("issue_ai_hermes_run_capability", {
          p_token_sha256: childTokenSha256,
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_conversation_id: conversationId,
          p_turn_id: turnId,
          p_invocation_id: childInvocationId,
          p_parent_invocation_id: invocationId,
          p_parent_token_sha256: rootTokenSha256,
          p_actor_fingerprint: actorFingerprint,
          p_allowed_tools: ["xingyao_memory_remember"],
          p_allowed_tools_hash: postgresArrayHash([
            "xingyao_memory_remember",
          ]),
          p_scopes: [],
          p_scope_hash: emptyHash,
          p_skill_grants_hash: emptyHash,
          p_skill_draft_ids: [],
          p_depth: 1,
          p_ai_state_writes_allowed: false,
          p_expires_at: expiresAt,
        });
        expect(child.error).toBeNull();

        const firstContent = "Prefer concise answers";
        const firstHash = sha256(firstContent);
        const rememberArgs = {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_capability_token_sha256: rootTokenSha256,
          p_parent_invocation_id: invocationId,
          p_idempotency_key: `${invocationId}:${firstHash}`,
          p_memory_key: null,
          p_expected_revision: 0,
          p_memory_type: "preference",
          p_content: firstContent,
          p_content_hash: firstHash,
          p_active: true,
          p_source_conversation_id: conversationId,
          p_source_message_id: sourceMessageId,
          p_source_invocation_id: invocationId,
        };
        const retries = await withTimeout(
          Promise.all([
            client.rpc("write_ai_hermes_memory_revision", rememberArgs),
            client.rpc("write_ai_hermes_memory_revision", rememberArgs),
          ]),
          10_000,
        );
        for (const retry of retries) expect(retry.error).toBeNull();
        const first = record(retries[0]?.data);
        const second = record(retries[1]?.data);
        expect(first.memory_id).toBe(second.memory_id);
        expect([first.reused, second.reused].sort()).toEqual([false, true]);
        const memoryKey = String(first.memory_key);

        const updateContent = "Prefer concise answers with headings";
        const updateHash = sha256(updateContent);
        const updated = await client.rpc("write_ai_hermes_memory_revision", {
          ...rememberArgs,
          p_idempotency_key: `${invocationId}:${updateHash}`,
          p_memory_key: memoryKey,
          p_expected_revision: 1,
          p_content: updateContent,
          p_content_hash: updateHash,
        });
        expect(updated.error).toBeNull();
        expect(record(updated.data).revision).toBe(2);

        const invalidSource = await client.rpc(
          "write_ai_hermes_memory_revision",
          {
            ...rememberArgs,
            p_idempotency_key: `${invocationId}:${sha256("Different")}`,
            p_memory_key: memoryKey,
            p_expected_revision: 2,
            p_content: "Different",
            p_content_hash: sha256("Different"),
            p_source_message_id: assistantMessageId,
          },
        );
        expect(invalidSource.error?.message).toContain("memory_source_invalid");

        const childWrite = await client.rpc(
          "write_ai_hermes_memory_revision",
          {
            ...rememberArgs,
            p_capability_token_sha256: childTokenSha256,
            p_parent_invocation_id: invocationId,
            p_idempotency_key: `${childInvocationId}:${sha256("Child")}`,
            p_memory_key: memoryKey,
            p_expected_revision: 2,
            p_content: "Child",
            p_content_hash: sha256("Child"),
            p_source_invocation_id: childInvocationId,
          },
        );
        expect(childWrite.error?.message).toContain(
          "memory_capability_invalid",
        );

        const forgetArgs = {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_capability_token_sha256: rootTokenSha256,
          p_parent_invocation_id: invocationId,
          p_memory_key: memoryKey,
          p_expected_revision: 2,
          p_source_conversation_id: conversationId,
          p_source_message_id: sourceMessageId,
          p_source_invocation_id: invocationId,
        };
        const forgotten = await withTimeout(
          Promise.all([
            client.rpc("forget_ai_hermes_memory", forgetArgs),
            client.rpc("forget_ai_hermes_memory", forgetArgs),
          ]),
          10_000,
        );
        for (const result of forgotten) expect(result.error).toBeNull();
        const forgottenRows = forgotten.map((result) => record(result.data));
        expect(forgottenRows[0]?.memory_id).toBe(forgottenRows[1]?.memory_id);
        expect(forgottenRows.map((row) => row.reused).sort()).toEqual([
          false,
          true,
        ]);

        const revisions = await client
          .from("ai_hermes_memories")
          .select("revision, content, active")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", memoryKey)
          .order("revision", { ascending: true });
        expect(revisions.error).toBeNull();
        expect(revisions.data).toEqual([
          { revision: 1, content: firstContent, active: false },
          { revision: 2, content: updateContent, active: false },
          { revision: 3, content: updateContent, active: false },
        ]);
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

function createLiveClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("live memory RPC returned an invalid payload");
  }
  return value as Record<string, unknown>;
}

function recordString(value: unknown, key: string): string {
  const row = record(value);
  if (typeof row[key] !== "string") {
    throw new Error(`live RPC did not return ${key}`);
  }
  return row[key];
}

function postgresArrayHash(values: string[]): string {
  return sha256(`[${values.map((value) => JSON.stringify(value)).join(", ")}]`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("live Hermes memory operation timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
