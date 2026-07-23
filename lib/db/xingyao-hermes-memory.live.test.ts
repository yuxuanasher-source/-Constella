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
        const expiresAt = new Date(Date.now() + 300_000).toISOString();
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
          .select("memory_snapshot_generation")
          .eq("token_sha256", rootTokenSha256)
          .single();
        expect(rootCapability.error).toBeNull();
        const rootMemorySnapshotGeneration = recordNumber(
          rootCapability.data,
          "memory_snapshot_generation",
        );
        const beforeWriteSnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          rootMemorySnapshotGeneration,
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

        const orderedContent = "Prefer stable memory ordering";
        const orderedHash = sha256(orderedContent);
        const orderedMemory = await client.rpc(
          "write_ai_hermes_memory_revision",
          {
            ...rememberArgs,
            p_idempotency_key: `${invocationId}:${orderedHash}`,
            p_memory_key: null,
            p_content: orderedContent,
            p_content_hash: orderedHash,
          },
        );
        expect(orderedMemory.error).toBeNull();
        const orderedMemoryKey = String(record(orderedMemory.data).memory_key);
        const orderedMemoryRow = await client
          .from("ai_hermes_memories")
          .select("created_at, effective_generation")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", orderedMemoryKey)
          .eq("revision", 1)
          .single();
        expect(orderedMemoryRow.error).toBeNull();
        const stableSnapshotAt = recordString(
          orderedMemoryRow.data,
          "created_at",
        );
        const stableSnapshotGeneration = recordNumber(
          orderedMemoryRow.data,
          "effective_generation",
        );
        const stableSnapshotBefore = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          stableSnapshotGeneration,
        );
        expect(stableSnapshotBefore).toHaveLength(2);
        const stableTargetBefore = memorySnapshotRow(
          stableSnapshotBefore,
          memoryKey,
        );
        const stableOrderedBefore = memorySnapshotRow(
          stableSnapshotBefore,
          orderedMemoryKey,
        );
        expect(stableTargetBefore).toMatchObject({
          content: firstContent,
          revision: 1,
        });
        expect(stableOrderedBefore).toMatchObject({
          content: orderedContent,
          revision: 1,
        });
        for (const value of stableSnapshotBefore) {
          expect(recordString(value, "updated_at")).toBe(
            recordString(value, "created_at"),
          );
          expect(
            Date.parse(recordString(value, "updated_at")),
          ).toBeLessThanOrEqual(Date.parse(stableSnapshotAt));
        }

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

        const orderedForget = await client.rpc("forget_ai_hermes_memory", {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_capability_token_sha256: rootTokenSha256,
          p_parent_invocation_id: invocationId,
          p_memory_key: orderedMemoryKey,
          p_expected_revision: 1,
          p_source_conversation_id: conversationId,
          p_source_message_id: sourceMessageId,
          p_source_invocation_id: invocationId,
        });
        expect(orderedForget.error).toBeNull();
        const stableSnapshotAfter = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          stableSnapshotGeneration,
        );
        expect(stableSnapshotAfter).toEqual(stableSnapshotBefore);
        expect(memorySnapshotRow(stableSnapshotAfter, memoryKey)).toEqual(
          stableTargetBefore,
        );
        expect(
          memorySnapshotRow(stableSnapshotAfter, orderedMemoryKey),
        ).toEqual(stableOrderedBefore);

        const updatedRevisionTimes = await client
          .from("ai_hermes_memories")
          .select(
            "revision, created_at, effective_generation, deactivated_generation",
          )
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
        const revisionOneGeneration = recordNumber(
          updatedRevisionTimes.data?.[0],
          "effective_generation",
        );
        const revisionTwoGeneration = recordNumber(
          updatedRevisionTimes.data?.[1],
          "effective_generation",
        );
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            rootMemorySnapshotGeneration,
          ),
        ).toEqual([]);
        const revisionOneSnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          revisionOneGeneration,
        );
        expect(revisionOneSnapshot).toHaveLength(1);
        expect(memorySnapshotRow(revisionOneSnapshot, memoryKey)).toMatchObject(
          {
            content: firstContent,
            revision: 1,
            updated_at: revisionOneCreatedAt,
          },
        );
        const revisionTwoSnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          revisionTwoGeneration,
        );
        const revisionTwoTarget = memorySnapshotRow(
          revisionTwoSnapshot,
          memoryKey,
        );
        const revisionTwoOrdered = memorySnapshotRow(
          revisionTwoSnapshot,
          orderedMemoryKey,
        );
        expect(revisionTwoTarget).toMatchObject({
          content: updateContent,
          revision: 2,
          updated_at: revisionTwoCreatedAt,
        });
        expect(revisionTwoOrdered).toMatchObject({
          content: orderedContent,
          revision: 1,
          updated_at: stableSnapshotAt,
        });

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
          .select("revision, created_at, effective_generation")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", memoryKey)
          .order("revision", { ascending: true });
        expect(forgottenRevisionTimes.error).toBeNull();
        const revisionThreeCreatedAt = recordString(
          forgottenRevisionTimes.data?.[2],
          "created_at",
        );
        const revisionThreeGeneration = recordNumber(
          forgottenRevisionTimes.data?.[2],
          "effective_generation",
        );
        expect(Date.parse(revisionThreeCreatedAt)).toBeGreaterThanOrEqual(
          Date.parse(revisionTwoCreatedAt),
        );
        const revisionTwoSnapshotAfterForget = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          revisionTwoGeneration,
        );
        expect(revisionTwoSnapshotAfterForget).toEqual(revisionTwoSnapshot);
        expect(
          memorySnapshotRow(revisionTwoSnapshotAfterForget, memoryKey),
        ).toEqual(revisionTwoTarget);
        expect(
          memorySnapshotRow(revisionTwoSnapshotAfterForget, orderedMemoryKey),
        ).toEqual(revisionTwoOrdered);
        expect(
          await loadMemorySnapshot(
            client,
            organizationId,
            userId,
            revisionThreeGeneration,
          ),
        ).toEqual([]);

        const atomicContent = "Prefer atomic memory commits";
        const atomicHash = sha256(atomicContent);
        const atomicClaim = await claimMemoryBrokerCall(client, {
          organizationId,
          userId,
          tokenSha256: rootTokenSha256,
          actorFingerprint,
          toolCallId: `atomic-remember-${suffix}`,
          toolName: "xingyao_memory_remember",
          sanitizedArguments: {
            memoryType: "preference",
            parentInvocationId: invocationId,
            sourceMessageId,
          },
        });
        const atomicRememberArgs = {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_broker_call_id: atomicClaim.brokerCallId,
          p_claim_owner_id: atomicClaim.claimOwnerId,
          p_fencing_token: atomicClaim.fencingToken,
          p_observed_at: new Date().toISOString(),
          p_operation: "remember",
          p_capability_token_sha256: rootTokenSha256,
          p_parent_invocation_id: invocationId,
          p_memory_key: null,
          p_expected_revision: 0,
          p_memory_type: "preference",
          p_content: atomicContent,
          p_content_hash: atomicHash,
          p_source_conversation_id: conversationId,
          p_source_message_id: sourceMessageId,
          p_source_invocation_id: invocationId,
        };
        const fencedOut = await client.rpc(
          "complete_ai_hermes_memory_broker_call",
          {
            ...atomicRememberArgs,
            p_fencing_token: atomicClaim.fencingToken + 1,
          },
        );
        expect(fencedOut.error?.message).toContain(
          "broker_claim_fence_invalid",
        );
        const rolledBackMemory = await client
          .from("ai_hermes_memories")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("content_hash", atomicHash);
        expect(rolledBackMemory.error).toBeNull();
        expect(rolledBackMemory.data).toEqual([]);

        const atomicCompleted = await client.rpc(
          "complete_ai_hermes_memory_broker_call",
          atomicRememberArgs,
        );
        expect(atomicCompleted.error).toBeNull();
        const atomicCompletedRow = record(atomicCompleted.data);
        expect(atomicCompletedRow.status).toBe("completed");
        const atomicEnvelope = record(
          atomicCompletedRow.sanitized_response_envelope,
        );
        expect(atomicEnvelope.status).toBe("ok");
        const atomicMemoryKey = recordString(atomicEnvelope.data, "memoryKey");
        const atomicMessageId = recordString(
          atomicCompleted.data,
          "message_id",
        );
        const atomicAudit = await client
          .from("ai_chat_messages")
          .select("role, content")
          .eq("id", atomicMessageId)
          .single();
        expect(atomicAudit.error).toBeNull();
        expect(atomicAudit.data?.role).toBe("tool");
        expect(atomicAudit.data?.content).not.toContain(atomicContent);

        const atomicReplay = await client.rpc(
          "complete_ai_hermes_memory_broker_call",
          atomicRememberArgs,
        );
        expect(atomicReplay.error).toBeNull();
        expect(record(atomicReplay.data)).toMatchObject({
          reused: true,
          message_id: atomicMessageId,
          sanitized_response_envelope:
            atomicCompletedRow.sanitized_response_envelope,
        });
        const atomicRowsAfterReplay = await client
          .from("ai_hermes_memories")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", atomicMemoryKey);
        expect(atomicRowsAfterReplay.error).toBeNull();
        expect(atomicRowsAfterReplay.data).toHaveLength(1);

        const atomicUpdateContent = "Prefer versioned atomic memory commits";
        const atomicUpdateHash = sha256(atomicUpdateContent);
        const updateClaim = await claimMemoryBrokerCall(client, {
          organizationId,
          userId,
          tokenSha256: rootTokenSha256,
          actorFingerprint,
          toolCallId: `atomic-update-${suffix}`,
          toolName: "xingyao_memory_remember",
          sanitizedArguments: {
            memoryKey: atomicMemoryKey,
            expectedRevision: 1,
            memoryType: "preference",
            parentInvocationId: invocationId,
            sourceMessageId,
          },
        });
        const forgetClaim = await claimMemoryBrokerCall(client, {
          organizationId,
          userId,
          tokenSha256: rootTokenSha256,
          actorFingerprint,
          toolCallId: `atomic-forget-${suffix}`,
          toolName: "xingyao_memory_forget",
          sanitizedArguments: {
            memoryKey: atomicMemoryKey,
            expectedRevision: 1,
            parentInvocationId: invocationId,
            sourceMessageId,
          },
        });
        const updateAtomicArgs = {
          ...atomicRememberArgs,
          p_broker_call_id: updateClaim.brokerCallId,
          p_claim_owner_id: updateClaim.claimOwnerId,
          p_fencing_token: updateClaim.fencingToken,
          p_observed_at: new Date().toISOString(),
          p_memory_key: atomicMemoryKey,
          p_expected_revision: 1,
          p_content: atomicUpdateContent,
          p_content_hash: atomicUpdateHash,
        };
        const forgetAtomicArgs = {
          ...atomicRememberArgs,
          p_broker_call_id: forgetClaim.brokerCallId,
          p_claim_owner_id: forgetClaim.claimOwnerId,
          p_fencing_token: forgetClaim.fencingToken,
          p_observed_at: new Date().toISOString(),
          p_operation: "forget",
          p_memory_key: atomicMemoryKey,
          p_expected_revision: 1,
          p_memory_type: null,
          p_content: null,
          p_content_hash: null,
        };
        const competing = await withTimeout(
          Promise.all([
            client.rpc(
              "complete_ai_hermes_memory_broker_call",
              updateAtomicArgs,
            ),
            client.rpc(
              "complete_ai_hermes_memory_broker_call",
              forgetAtomicArgs,
            ),
          ]),
          10_000,
        );
        for (const result of competing) expect(result.error).toBeNull();
        const competingRows = competing.map((result) => record(result.data));
        expect(competingRows.map((row) => row.status).sort()).toEqual([
          "completed",
          "failed",
        ]);
        const conflictRow = competingRows.find(
          (row) => row.status === "failed",
        );
        expect(
          record(record(conflictRow?.sanitized_response_envelope).error).code,
        ).toBe("state_conflict");
        const atomicRevisions = await client
          .from("ai_hermes_memories")
          .select("revision")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", atomicMemoryKey)
          .order("revision", { ascending: true });
        expect(atomicRevisions.error).toBeNull();
        expect(atomicRevisions.data).toEqual([
          { revision: 1 },
          { revision: 2 },
        ]);

        const competingReplay = await Promise.all([
          client.rpc("complete_ai_hermes_memory_broker_call", updateAtomicArgs),
          client.rpc("complete_ai_hermes_memory_broker_call", forgetAtomicArgs),
        ]);
        for (const replay of competingReplay) {
          expect(replay.error).toBeNull();
          expect(record(replay.data).reused).toBe(true);
        }
        const atomicBrokerRows = await client
          .from("ai_hermes_broker_calls")
          .select("tool_message_id")
          .in("id", [
            atomicClaim.brokerCallId,
            updateClaim.brokerCallId,
            forgetClaim.brokerCallId,
          ]);
        expect(atomicBrokerRows.error).toBeNull();
        expect(
          new Set(
            atomicBrokerRows.data?.map((row) => row.tool_message_id) ?? [],
          ).size,
        ).toBe(3);

        const raceConversation = await client
          .from("ai_conversations")
          .insert({
            organization_id: organizationId,
            owner_user_id: userId,
            title: "Hermes memory source race",
          })
          .select("id")
          .single();
        expect(raceConversation.error).toBeNull();
        const raceConversationId = raceConversation.data?.id;
        if (!raceConversationId) {
          throw new Error("race conversation was not created");
        }

        const raceTurn = await client.rpc("create_ai_chat_turn", {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_conversation_id: raceConversationId,
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
            p_conversation_id: raceConversationId,
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
            p_expires_at: new Date(Date.now() + 300_000).toISOString(),
          },
        );
        expect(raceCapability.error).toBeNull();
        const raceContent = "Prefer source-locked summaries";
        const raceHash = sha256(raceContent);
        const raceWriteArgs = {
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
          p_source_conversation_id: raceConversationId,
          p_source_message_id: raceSourceMessageId,
          p_source_invocation_id: raceInvocationId,
        };
        const [raceWrite, raceMutation] = await withTimeout(
          Promise.all([
            client.rpc("write_ai_hermes_memory_revision", raceWriteArgs),
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

        if (raceWrite.error) {
          const restoredSource = await client
            .from("ai_chat_messages")
            .update({ role: "user" })
            .eq("id", raceSourceMessageId)
            .select("id, role")
            .single();
          expect(restoredSource.error).toBeNull();
          expect(restoredSource.data?.role).toBe("user");
          const committedWrite = await client.rpc(
            "write_ai_hermes_memory_revision",
            raceWriteArgs,
          );
          expect(committedWrite.error).toBeNull();
        }

        const postCommitMutation = await client
          .from("ai_chat_messages")
          .update({ role: "assistant" })
          .eq("id", raceSourceMessageId)
          .select("id, role")
          .single();
        expect(postCommitMutation.error?.message).toContain(
          "memory_source_immutable",
        );
        const committedRaceMemories = await client
          .from("ai_hermes_memories")
          .select("id")
          .eq("source_message_id", raceSourceMessageId);
        const committedRaceSource = await client
          .from("ai_chat_messages")
          .select("role")
          .eq("id", raceSourceMessageId)
          .single();
        expect(committedRaceMemories.error).toBeNull();
        expect(committedRaceMemories.data).toHaveLength(1);
        expect(committedRaceSource.error).toBeNull();
        expect(committedRaceSource.data?.role).toBe("user");

        const observationConversation = await client
          .from("ai_conversations")
          .insert({
            organization_id: organizationId,
            owner_user_id: userId,
            title: "Hermes generation observation",
          })
          .select("id")
          .single();
        expect(observationConversation.error).toBeNull();
        const observationConversationId = observationConversation.data?.id;
        if (!observationConversationId) {
          throw new Error("observation conversation was not created");
        }
        const generationContentA = "Prefer generation ordered alpha notes";
        const generationHashA = sha256(generationContentA);
        const generationWriteA = {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_capability_token_sha256: raceTokenSha256,
          p_parent_invocation_id: raceInvocationId,
          p_idempotency_key: `${raceInvocationId}:${generationHashA}`,
          p_memory_key: null,
          p_expected_revision: 0,
          p_memory_type: "preference",
          p_content: generationContentA,
          p_content_hash: generationHashA,
          p_active: true,
          p_source_conversation_id: raceConversationId,
          p_source_message_id: raceSourceMessageId,
          p_source_invocation_id: raceInvocationId,
        };
        const [generationAResult, observationTurn] = await withTimeout(
          Promise.all([
            client.rpc("write_ai_hermes_memory_revision", generationWriteA),
            client.rpc("create_ai_chat_turn", {
              p_organization_id: organizationId,
              p_owner_user_id: userId,
              p_conversation_id: observationConversationId,
              p_idempotency_key: `hermes-generation-observe-${suffix}`,
              p_mode: "fast",
              p_kind: "user",
              p_content: "Observe the committed memory generation.",
              p_source_turn_id: null,
            }),
          ]),
          10_000,
        );
        expect(generationAResult.error).toBeNull();
        expect(observationTurn.error).toBeNull();
        const generationMemoryKeyA = recordString(
          generationAResult.data,
          "memory_key",
        );
        const observationTurnId = recordString(observationTurn.data, "turn_id");
        const generationRowA = await client
          .from("ai_hermes_memories")
          .select("id, effective_generation")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", generationMemoryKeyA)
          .single();
        expect(generationRowA.error).toBeNull();
        const effectiveGenerationA = recordNumber(
          generationRowA.data,
          "effective_generation",
        );
        const observedTurn = await client
          .from("ai_chat_turns")
          .select("memory_snapshot_generation")
          .eq("id", observationTurnId)
          .single();
        expect(observedTurn.error).toBeNull();
        const observedGeneration = recordNumber(
          observedTurn.data,
          "memory_snapshot_generation",
        );
        const observedSnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          observedGeneration,
        );
        expect(
          observedSnapshot.some(
            (value) =>
              recordString(value, "memory_key") === generationMemoryKeyA,
          ),
        ).toBe(effectiveGenerationA <= observedGeneration);

        const generationContentB = "Prefer generation ordered beta notes";
        const generationHashB = sha256(generationContentB);
        const generationBResult = await client.rpc(
          "write_ai_hermes_memory_revision",
          {
            ...generationWriteA,
            p_idempotency_key: `${raceInvocationId}:${generationHashB}`,
            p_content: generationContentB,
            p_content_hash: generationHashB,
          },
        );
        expect(generationBResult.error).toBeNull();
        const generationMemoryKeyB = recordString(
          generationBResult.data,
          "memory_key",
        );
        const generationRowB = await client
          .from("ai_hermes_memories")
          .select("id, effective_generation")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("memory_key", generationMemoryKeyB)
          .single();
        expect(generationRowB.error).toBeNull();
        const effectiveGenerationB = recordNumber(
          generationRowB.data,
          "effective_generation",
        );
        expect(effectiveGenerationB).toBe(effectiveGenerationA + 1);

        const equalDisplayTimestamp = "2026-07-22T00:00:00.000Z";
        const equalized = await client
          .from("ai_hermes_memories")
          .update({ created_at: equalDisplayTimestamp })
          .in("id", [
            recordString(generationRowA.data, "id"),
            recordString(generationRowB.data, "id"),
          ]);
        expect(equalized.error).toBeNull();
        const generationASnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          effectiveGenerationA,
        );
        expect(
          generationASnapshot.some(
            (value) =>
              recordString(value, "memory_key") === generationMemoryKeyA,
          ),
        ).toBe(true);
        expect(
          generationASnapshot.some(
            (value) =>
              recordString(value, "memory_key") === generationMemoryKeyB,
          ),
        ).toBe(false);
        const generationBSnapshot = await loadMemorySnapshot(
          client,
          organizationId,
          userId,
          effectiveGenerationB,
        );
        expect(
          generationBSnapshot.filter((value) => {
            const key = recordString(value, "memory_key");
            return key === generationMemoryKeyA || key === generationMemoryKeyB;
          }),
        ).toHaveLength(2);

        const deniedContent = "Prefer capability-race-safe memories";
        const deniedHash = sha256(deniedContent);
        const deniedClaim = await claimMemoryBrokerCall(client, {
          organizationId,
          userId,
          tokenSha256: raceTokenSha256,
          actorFingerprint: sha256(`race-actor:${suffix}`),
          toolCallId: `atomic-denied-${suffix}`,
          toolName: "xingyao_memory_remember",
          sanitizedArguments: {
            memoryType: "preference",
            parentInvocationId: raceInvocationId,
            sourceMessageId: raceSourceMessageId,
          },
        });
        const revoked = await client
          .from("ai_hermes_run_capabilities")
          .update({ revoked_at: new Date().toISOString() })
          .eq("token_sha256", raceTokenSha256);
        expect(revoked.error).toBeNull();

        const deniedCompletionArgs = {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_broker_call_id: deniedClaim.brokerCallId,
          p_claim_owner_id: deniedClaim.claimOwnerId,
          p_fencing_token: deniedClaim.fencingToken,
          p_observed_at: new Date().toISOString(),
          p_operation: "remember",
          p_capability_token_sha256: raceTokenSha256,
          p_parent_invocation_id: raceInvocationId,
          p_memory_key: null,
          p_expected_revision: 0,
          p_memory_type: "preference",
          p_content: deniedContent,
          p_content_hash: deniedHash,
          p_source_conversation_id: raceConversationId,
          p_source_message_id: raceSourceMessageId,
          p_source_invocation_id: raceInvocationId,
        };
        const deniedCompletion = await client.rpc(
          "complete_ai_hermes_memory_broker_call",
          deniedCompletionArgs,
        );
        expect(deniedCompletion.error).toBeNull();
        const deniedCompletionRow = record(deniedCompletion.data);
        expect(deniedCompletionRow.status).toBe("denied");
        expect(
          record(
            record(deniedCompletionRow.sanitized_response_envelope).error,
          ).code,
        ).toBe("permission_denied");
        const deniedMemory = await client
          .from("ai_hermes_memories")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("owner_user_id", userId)
          .eq("content_hash", deniedHash);
        expect(deniedMemory.error).toBeNull();
        expect(deniedMemory.data).toEqual([]);
        const deniedAudit = await client
          .from("ai_chat_messages")
          .select("role, content")
          .eq("id", recordString(deniedCompletion.data, "message_id"))
          .single();
        expect(deniedAudit.error).toBeNull();
        expect(deniedAudit.data?.role).toBe("tool");
        expect(deniedAudit.data?.content).not.toContain(deniedContent);
        const deniedReplay = await client.rpc(
          "complete_ai_hermes_memory_broker_call",
          deniedCompletionArgs,
        );
        expect(deniedReplay.error).toBeNull();
        expect(record(deniedReplay.data)).toMatchObject({
          reused: true,
          message_id: deniedCompletionRow.message_id,
          sanitized_response_envelope:
            deniedCompletionRow.sanitized_response_envelope,
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
    60_000,
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

function recordNumber(value: unknown, key: string): number {
  const row = record(value);
  if (!Number.isSafeInteger(row[key])) {
    throw new Error(`live RPC did not return ${key}`);
  }
  return Number(row[key]);
}

function memorySnapshotRow(
  snapshot: unknown[],
  memoryKey: string,
): Record<string, unknown> {
  const matches = snapshot.filter(
    (value) => recordString(value, "memory_key") === memoryKey,
  );
  expect(matches).toHaveLength(1);
  return record(matches[0]);
}

async function claimMemoryBrokerCall(
  client: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    tokenSha256: string;
    actorFingerprint: string;
    toolCallId: string;
    toolName: "xingyao_memory_remember" | "xingyao_memory_forget";
    sanitizedArguments: Record<string, unknown>;
  },
): Promise<{
  brokerCallId: string;
  claimOwnerId: string;
  fencingToken: number;
}> {
  const claimOwnerId = randomUUID();
  const claimed = await client.rpc("claim_ai_hermes_broker_call", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_token_sha256: input.tokenSha256,
    p_actor_fingerprint: input.actorFingerprint,
    p_claim_owner_id: claimOwnerId,
    p_tool_call_id: input.toolCallId,
    p_tool_name: input.toolName,
    p_request_sha256: sha256(`request:${input.toolCallId}`),
    p_sanitized_request_envelope: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      arguments: input.sanitizedArguments,
    },
  });
  expect(claimed.error).toBeNull();
  expect(record(claimed.data).execute).toBe(true);
  return {
    brokerCallId: recordString(claimed.data, "broker_call_id"),
    claimOwnerId,
    fencingToken: recordNumber(claimed.data, "fencing_token"),
  };
}

async function loadMemorySnapshot(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  snapshotGeneration: number,
): Promise<unknown[]> {
  const result = await client.rpc("load_ai_hermes_memory_snapshot", {
    p_organization_id: organizationId,
    p_owner_user_id: userId,
    p_snapshot_generation: snapshotGeneration,
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
