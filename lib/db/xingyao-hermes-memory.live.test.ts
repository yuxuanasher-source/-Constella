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
        const rootCapability = await client
          .from("ai_hermes_run_capabilities")
          .select("memory_snapshot_at")
          .eq("token_sha256", rootTokenSha256)
          .single();
        expect(rootCapability.error).toBeNull();
        const rootMemorySnapshotAt = recordString(
          rootCapability.data,
          "memory_snapshot_at",
        );
        const beforeWriteSnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          rootMemorySnapshotAt,
        );
        expect(beforeWriteSnapshot).toEqual([]);

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
          p_allowed_tools: [],
          p_allowed_tools_hash: emptyHash,
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

        const updatedRevisionTimes = await client
          .from("ai_hermes_memories")
          .select("revision, created_at, deactivated_at")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", memoryKey)
          .order("revision", { ascending: true });
        expect(updatedRevisionTimes.error).toBeNull();
        const revisionOneCreatedAt = recordString(
          updatedRevisionTimes.data?.[0],
          "created_at",
        );
        const revisionTwoCreatedAt = recordString(
          updatedRevisionTimes.data?.[1],
          "created_at",
        );
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            rootMemorySnapshotAt,
          ),
        ).toEqual([]);
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            revisionOneCreatedAt,
          ),
        ).toEqual([expect.objectContaining({ revision: 1 })]);
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            revisionTwoCreatedAt,
          ),
        ).toEqual([expect.objectContaining({ revision: 2 })]);

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

        const childWrite = await client.rpc("write_ai_hermes_memory_revision", {
          ...rememberArgs,
          p_capability_token_sha256: childTokenSha256,
          p_parent_invocation_id: invocationId,
          p_idempotency_key: `${childInvocationId}:${sha256("Child")}`,
          p_memory_key: memoryKey,
          p_expected_revision: 2,
          p_content: "Child",
          p_content_hash: sha256("Child"),
          p_source_invocation_id: childInvocationId,
        });
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

        const forgottenRevisionTimes = await client
          .from("ai_hermes_memories")
          .select("revision, created_at")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", memoryKey)
          .order("revision", { ascending: true });
        expect(forgottenRevisionTimes.error).toBeNull();
        const revisionThreeCreatedAt = recordString(
          forgottenRevisionTimes.data?.[2],
          "created_at",
        );
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            revisionTwoCreatedAt,
          ),
        ).toEqual([expect.objectContaining({ revision: 2 })]);
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            revisionThreeCreatedAt,
          ),
        ).toEqual([]);

        const raceTurn = await client.rpc("create_ai_chat_turn", {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_conversation_id: conversationId,
          p_idempotency_key: `hermes-memory-race-${suffix}`,
          p_mode: "fast",
          p_kind: "user",
          p_content: "Remember this source atomically.",
          p_source_turn_id: null,
        });
        expect(raceTurn.error).toBeNull();
        const raceTurnId = recordString(raceTurn.data, "turn_id");
        const raceSourceMessageId = recordString(
          raceTurn.data,
          "user_message_id",
        );
        const raceInvocationId = randomUUID();
        expect(
          (
            await client.from("ai_invocations").insert({
              id: raceInvocationId,
              organization_id: organizationId,
              actor_user_id: userId,
              actor_role: "owner",
              scene: "hermes_memory_source_race",
            })
          ).error,
        ).toBeNull();
        const raceTokenSha256 = sha256(`race:${suffix}`);
        const raceCapability = await client.rpc(
          "issue_ai_hermes_run_capability",
          {
            p_token_sha256: raceTokenSha256,
            p_organization_id: organizationId,
            p_owner_user_id: userId,
            p_conversation_id: conversationId,
            p_turn_id: raceTurnId,
            p_invocation_id: raceInvocationId,
            p_parent_invocation_id: null,
            p_parent_token_sha256: null,
            p_actor_fingerprint: sha256(`race-actor:${suffix}`),
            p_allowed_tools: ["xingyao_memory_remember"],
            p_allowed_tools_hash: postgresArrayHash([
              "xingyao_memory_remember",
            ]),
            p_scopes: [],
            p_scope_hash: emptyHash,
            p_skill_grants_hash: emptyHash,
            p_skill_draft_ids: [],
            p_depth: 0,
            p_ai_state_writes_allowed: true,
            p_expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        );
        expect(raceCapability.error).toBeNull();
        const raceContent = "Prefer source-locked summaries";
        const raceHash = sha256(raceContent);
        const [raceWrite, raceMutation] = await withTimeout(
          Promise.all([
            client.rpc("write_ai_hermes_memory_revision", {
              p_organization_id: organizationId,
              p_owner_user_id: userId,
              p_capability_token_sha256: raceTokenSha256,
              p_parent_invocation_id: raceInvocationId,
              p_idempotency_key: `${raceInvocationId}:${raceHash}`,
              p_memory_key: null,
              p_expected_revision: 0,
              p_memory_type: "preference",
              p_content: raceContent,
              p_content_hash: raceHash,
              p_active: true,
              p_source_conversation_id: conversationId,
              p_source_message_id: raceSourceMessageId,
              p_source_invocation_id: raceInvocationId,
            }),
            client
              .from("ai_chat_messages")
              .update({ role: "assistant" })
              .eq("id", raceSourceMessageId)
              .select("id, role")
              .single(),
          ]),
          10_000,
        );
        expect(Number(!raceWrite.error) + Number(!raceMutation.error)).toBe(1);

        const racedMemories = await client
          .from("ai_hermes_memories")
          .select("id")
          .eq("source_message_id", raceSourceMessageId);
        const racedSource = await client
          .from("ai_chat_messages")
          .select("role")
          .eq("id", raceSourceMessageId)
          .single();
        expect(racedMemories.error).toBeNull();
        expect(racedSource.error).toBeNull();
        if (raceWrite.error) {
          expect(raceWrite.error.message).toContain("memory_source_invalid");
          expect(racedMemories.data).toEqual([]);
          expect(racedSource.data?.role).toBe("assistant");
        } else {
          expect(raceMutation.error?.message).toContain(
            "memory_source_immutable",
          );
          expect(racedMemories.data).toHaveLength(1);
          expect(racedSource.data?.role).toBe("user");
        }
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

async function loadMemorySnapshot(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  snapshotAt: string,
): Promise<unknown[]> {
  const result = await client.rpc("load_ai_hermes_memory_snapshot", {
    p_organization_id: organizationId,
    p_owner_user_id: userId,
    p_snapshot_at: snapshotAt,
  });
  expect(result.error).toBeNull();
  if (!Array.isArray(result.data)) {
    throw new Error("live memory snapshot RPC returned an invalid payload");
  }
  return result.data;
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
          () => reject(new Error("live Hermes memory operation timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
