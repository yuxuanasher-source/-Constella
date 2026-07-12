import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260711115500_xingyao_duplicate_lease_recovery.sql",
);
const LIVE_ENABLED =
  process.env.RUN_XINGYAO_LEASE_RECOVERY_LIVE === "1" &&
  Boolean(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  ) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Xingyao duplicate lease recovery migration", () => {
  it("reconciles expired turns before returning an idempotent duplicate", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    const cleanup = sql.indexOf("with expired_turns as");
    const duplicateLookup = sql.indexOf(
      "and idempotency_key = p_idempotency_key",
    );

    expect(sql).toContain(
      "create or replace function public.create_ai_chat_turn",
    );
    expect(cleanup).toBeGreaterThan(0);
    expect(duplicateLookup).toBeGreaterThan(cleanup);
    expect(sql).toContain("error_code = 'turn_lease_expired'");
    expect(sql).not.toMatch(/interval\s+'[^']+'\s*;?\s*--\s*test/u);
  });

  it.runIf(LIVE_ENABLED)(
    "expires the duplicate first, creates one retry successor, and cleans all residue",
    async () => {
      const client = createLiveClient();
      const suffix = randomUUID();
      const email = `xingyao-lease-${suffix}@example.test`;
      let userId: string | null = null;
      let organizationId: string | null = null;
      let conversationId: string | null = null;

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
          .insert({ name: `Lease Recovery ${suffix}`, code: `lease-${suffix}` })
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
          full_name: "Lease Recovery Test",
        });
        expect(profile.error).toBeNull();
        const conversation = await client
          .from("ai_conversations")
          .insert({
            organization_id: organizationId,
            owner_user_id: userId,
            title: "Lease recovery regression",
          })
          .select("id")
          .single();
        expect(conversation.error).toBeNull();
        conversationId = conversation.data?.id ?? null;
        if (!conversationId) {
          throw new Error("live fixture conversation was not created");
        }

        const startKey = `lease-start-${suffix}`;
        const accepted = await createTurn(client, {
          organizationId,
          userId,
          conversationId,
          idempotencyKey: startKey,
          kind: "user",
          content: "Recover this expired settlement start.",
          sourceTurnId: null,
        });
        expect(accepted.duplicate).toBe(false);
        expect(accepted.status).toBe("accepted");

        const expired = await client
          .from("ai_chat_turns")
          .update({ lease_expires_at: "2000-01-01T00:00:00.000Z" })
          .eq("id", accepted.turnId);
        expect(expired.error).toBeNull();

        const duplicate = await createTurn(client, {
          organizationId,
          userId,
          conversationId,
          idempotencyKey: startKey,
          kind: "user",
          content: "Recover this expired settlement start.",
          sourceTurnId: null,
        });
        expect(duplicate).toMatchObject({
          turnId: accepted.turnId,
          status: "failed",
          duplicate: true,
        });
        const source = await client
          .from("ai_chat_turns")
          .select("status,error_code,retryable,retry_of_turn_id")
          .eq("id", accepted.turnId)
          .single();
        expect(source.error).toBeNull();
        expect(source.data).toMatchObject({
          status: "failed",
          error_code: "turn_lease_expired",
          retryable: true,
          retry_of_turn_id: null,
        });
        const assistant = await client
          .from("ai_chat_messages")
          .select("status,metadata")
          .eq("id", accepted.assistantMessageId)
          .single();
        expect(assistant.error).toBeNull();
        expect(assistant.data).toMatchObject({
          status: "failed",
          metadata: { errorCode: "turn_lease_expired", retryable: true },
        });

        const retryKey = `lease-retry-${suffix}`;
        const retryRequest = () =>
          createTurn(client, {
            organizationId: organizationId!,
            userId: userId!,
            conversationId: conversationId!,
            idempotencyKey: retryKey,
            kind: "retry",
            content: null,
            sourceTurnId: accepted.turnId,
          });
        const [firstRetry, secondRetry] = await withTimeout(
          Promise.all([retryRequest(), retryRequest()]),
          5_000,
        );
        expect(firstRetry.turnId).toBe(secondRetry.turnId);
        expect([firstRetry.duplicate, secondRetry.duplicate].sort()).toEqual([
          false,
          true,
        ]);
        const successors = await client
          .from("ai_chat_turns")
          .select("id,retry_of_turn_id,attempt_no,user_message_id")
          .eq("retry_of_turn_id", accepted.turnId);
        expect(successors.error).toBeNull();
        expect(successors.data).toHaveLength(1);
        expect(successors.data?.[0]).toMatchObject({
          id: firstRetry.turnId,
          retry_of_turn_id: accepted.turnId,
          attempt_no: 2,
          user_message_id: accepted.userMessageId,
        });
        const supersededAssistant = await client
          .from("ai_chat_messages")
          .select("status,metadata")
          .eq("id", accepted.assistantMessageId)
          .single();
        expect(supersededAssistant.error).toBeNull();
        expect(supersededAssistant.data).toMatchObject({
          status: "superseded",
          metadata: { errorCode: "turn_lease_expired", retryable: true },
        });

        const removed = await client
          .from("ai_conversations")
          .delete()
          .eq("id", conversationId);
        expect(removed.error).toBeNull();
        conversationId = null;
        const turnResidue = await client
          .from("ai_chat_turns")
          .select("id", { count: "exact", head: true })
          .in("id", [accepted.turnId, firstRetry.turnId]);
        const messageResidue = await client
          .from("ai_chat_messages")
          .select("id", { count: "exact", head: true })
          .in("id", [
            accepted.userMessageId,
            accepted.assistantMessageId,
            firstRetry.assistantMessageId,
          ]);
        expect(turnResidue.error).toBeNull();
        expect(messageResidue.error).toBeNull();
        expect(turnResidue.count).toBe(0);
        expect(messageResidue.count).toBe(0);
      } finally {
        if (conversationId) {
          await client.from("ai_conversations").delete().eq("id", conversationId);
        }
        if (organizationId) {
          await client.from("organizations").delete().eq("id", organizationId);
        }
        if (userId) {
          await client.from("profiles").delete().eq("id", userId);
          await client.auth.admin.deleteUser(userId);
        }
      }
    },
    20_000,
  );
});

type CreatedTurn = {
  conversationId: string;
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: string;
  attempt: number;
  duplicate: boolean;
};

function createLiveClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createTurn(
  client: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    idempotencyKey: string;
    kind: "user" | "retry";
    content: string | null;
    sourceTurnId: string | null;
  },
): Promise<CreatedTurn> {
  const result = await client.rpc("create_ai_chat_turn", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_idempotency_key: input.idempotencyKey,
    p_mode: "fast",
    p_kind: input.kind,
    p_content: input.content,
    p_source_turn_id: input.sourceTurnId,
  });
  expect(result.error).toBeNull();
  const value = result.data;
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversation_id" in value) ||
    !("turn_id" in value) ||
    !("user_message_id" in value) ||
    !("assistant_message_id" in value) ||
    !("status" in value) ||
    !("attempt_no" in value)
  ) {
    throw new Error("create_ai_chat_turn returned an invalid payload");
  }
  return {
    conversationId: String(value.conversation_id),
    turnId: String(value.turn_id),
    userMessageId: String(value.user_message_id),
    assistantMessageId: String(value.assistant_message_id),
    status: String(value.status),
    attempt: Number(value.attempt_no),
    duplicate: value.duplicate === true,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("live lease recovery timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
