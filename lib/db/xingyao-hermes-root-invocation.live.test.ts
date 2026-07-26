import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const LIVE_ENABLED =
  process.env.RUN_HERMES_ROOT_INVOCATION_LIVE === "1" &&
  Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Hermes root invocation atomicity", () => {
  it.runIf(LIVE_ENABLED)(
    "rolls back failed issuance, rejects identity drift, and closes terminal ledgers",
    async () => {
      const client = createLiveClient();
      const suffix = randomUUID();
      const email = `hermes-root-${suffix}@example.test`;
      let userId: string | null = null;
      let organizationId: string | null = null;
      let otherOrganizationId: string | null = null;

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
            name: `Hermes Root ${suffix}`,
            code: `hermes-root-${suffix}`,
          })
          .select("id")
          .single();
        expect(organization.error).toBeNull();
        organizationId = organization.data?.id ?? null;
        if (!organizationId) {
          throw new Error("live fixture organization was not created");
        }

        const otherOrganization = await client
          .from("organizations")
          .insert({
            name: `Hermes Root Other ${suffix}`,
            code: `hermes-root-other-${suffix}`,
          })
          .select("id")
          .single();
        expect(otherOrganization.error).toBeNull();
        otherOrganizationId = otherOrganization.data?.id ?? null;
        if (!otherOrganizationId) {
          throw new Error("live fixture secondary organization was not created");
        }

        expect(
          (
            await client.from("profiles").insert({
              id: userId,
              email,
              full_name: "Hermes Root Test",
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await client.from("organization_members").insert({
              organization_id: organizationId,
              user_id: userId,
              role: "owner",
              status: "active",
            })
          ).error,
        ).toBeNull();

        const success = await createTurn(client, {
          organizationId,
          userId,
          suffix: `success-${suffix}`,
        });
        const firstToken = sha256(`success:${suffix}:1`);
        expect(
          (
            await issueRoot(client, {
              organizationId,
              userId,
              ...success,
              tokenSha256: firstToken,
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await issueRoot(client, {
              organizationId,
              userId,
              ...success,
              tokenSha256: sha256(`success:${suffix}:2`),
            })
          ).error,
        ).toBeNull();

        const started = await client
          .from("ai_invocations")
          .select("id, status")
          .eq("id", success.turnId)
          .single();
        expect(started.error).toBeNull();
        expect(started.data).toMatchObject({
          id: success.turnId,
          status: "started",
        });

        const finished = await client.rpc("finish_ai_chat_turn_v2", {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_turn_id: success.turnId,
          p_outcome: "complete",
          p_content: "Completed",
          p_provider_name: "hermes",
          p_ai_invocation_id: success.turnId,
          p_error_code: null,
          p_error_summary: null,
          p_retryable: false,
          p_metadata: {},
        });
        expect(finished.error).toBeNull();
        expect(finished.data).toBe(true);
        await expectInvocationState(client, success.turnId, {
          status: "succeeded",
          degradedReason: null,
        });

        const cancelled = await createTurn(client, {
          organizationId,
          userId,
          suffix: `cancel-${suffix}`,
        });
        expect(
          (
            await issueRoot(client, {
              organizationId,
              userId,
              ...cancelled,
              tokenSha256: sha256(`cancel:${suffix}`),
            })
          ).error,
        ).toBeNull();
        const cancelResult = await client.rpc("cancel_ai_chat_turn", {
          p_organization_id: organizationId,
          p_owner_user_id: userId,
          p_conversation_id: cancelled.conversationId,
          p_turn_id: cancelled.turnId,
        });
        expect(cancelResult.error).toBeNull();
        await expectInvocationState(client, cancelled.turnId, {
          status: "failed",
          degradedReason: "cancelled",
        });

        const rollback = await createTurn(client, {
          organizationId,
          userId,
          suffix: `rollback-${suffix}`,
        });
        const rollbackIssue = await issueRoot(client, {
          organizationId,
          userId,
          ...rollback,
          tokenSha256: sha256(`rollback:${suffix}`),
          scopeHash: "f".repeat(64),
        });
        expect(rollbackIssue.error).not.toBeNull();
        await expectInvocationMissing(client, rollback.turnId);

        const conflict = await createTurn(client, {
          organizationId,
          userId,
          suffix: `conflict-${suffix}`,
        });
        expect(
          (
            await client.from("ai_invocations").insert({
              id: conflict.turnId,
              organization_id: organizationId,
              actor_user_id: userId,
              actor_role: "owner",
              scene: "conflicting_scene",
              provider_name: "openai",
              primary_provider: "openai",
              status: "started",
            })
          ).error,
        ).toBeNull();
        const conflictIssue = await issueRoot(client, {
          organizationId,
          userId,
          ...conflict,
          tokenSha256: sha256(`conflict:${suffix}`),
        });
        expect(conflictIssue.error).not.toBeNull();
        const preserved = await client
          .from("ai_invocations")
          .select("scene, provider_name, primary_provider")
          .eq("id", conflict.turnId)
          .single();
        expect(preserved.error).toBeNull();
        expect(preserved.data).toEqual({
          scene: "conflicting_scene",
          provider_name: "openai",
          primary_provider: "openai",
        });

        const roleMismatch = await createTurn(client, {
          organizationId,
          userId,
          suffix: `role-${suffix}`,
        });
        const roleIssue = await issueRoot(client, {
          organizationId,
          userId,
          ...roleMismatch,
          tokenSha256: sha256(`role:${suffix}`),
          actorRole: "finance",
        });
        expect(roleIssue.error).not.toBeNull();
        await expectInvocationMissing(client, roleMismatch.turnId);

        const crossOrganization = await createTurn(client, {
          organizationId,
          userId,
          suffix: `cross-org-${suffix}`,
        });
        const crossOrganizationInvocationId = randomUUID();
        const crossOrganizationIssue = await issueRoot(client, {
          organizationId: otherOrganizationId,
          userId,
          conversationId: crossOrganization.conversationId,
          turnId: crossOrganization.turnId,
          invocationId: crossOrganizationInvocationId,
          tokenSha256: sha256(`cross-org:${suffix}`),
        });
        expect(crossOrganizationIssue.error).not.toBeNull();
        await expectInvocationMissing(client, crossOrganizationInvocationId);
      } finally {
        if (otherOrganizationId) {
          await client
            .from("organizations")
            .delete()
            .eq("id", otherOrganizationId);
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
    60_000,
  );
});

async function createTurn(
  client: SupabaseClient,
  input: { organizationId: string; userId: string; suffix: string },
): Promise<{ conversationId: string; turnId: string; invocationId: string }> {
  const conversation = await client
    .from("ai_conversations")
    .insert({
      organization_id: input.organizationId,
      owner_user_id: input.userId,
      title: `Hermes root ${input.suffix}`,
    })
    .select("id")
    .single();
  expect(conversation.error).toBeNull();
  const conversationId = conversation.data?.id;
  if (!conversationId) throw new Error("live fixture conversation was not created");

  const turn = await client.rpc("create_ai_chat_turn", {
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_conversation_id: conversationId,
    p_idempotency_key: `hermes-root-${input.suffix}`,
    p_mode: "fast",
    p_kind: "user",
    p_content: "Verify root invocation atomicity.",
    p_source_turn_id: null,
  });
  expect(turn.error).toBeNull();
  const turnId = recordString(turn.data, "turn_id");
  return { conversationId, turnId, invocationId: turnId };
}

async function issueRoot(
  client: SupabaseClient,
  input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    turnId: string;
    invocationId: string;
    tokenSha256: string;
    actorRole?: "owner" | "finance";
    scopeHash?: string;
  },
) {
  const emptyHash = postgresArrayHash([]);
  return client.rpc("issue_ai_hermes_root_run_capability", {
    p_token_sha256: input.tokenSha256,
    p_organization_id: input.organizationId,
    p_owner_user_id: input.userId,
    p_actor_role: input.actorRole ?? "owner",
    p_conversation_id: input.conversationId,
    p_turn_id: input.turnId,
    p_invocation_id: input.invocationId,
    p_parent_invocation_id: null,
    p_parent_token_sha256: null,
    p_actor_fingerprint: sha256(`actor:${input.userId}`),
    p_allowed_tools: [],
    p_allowed_tools_hash: emptyHash,
    p_scopes: [],
    p_scope_hash: input.scopeHash ?? emptyHash,
    p_skill_grants_hash: emptyHash,
    p_skill_draft_ids: [],
    p_depth: 0,
    p_ai_state_writes_allowed: false,
    p_expires_at: new Date(Date.now() + 300_000).toISOString(),
  });
}

async function expectInvocationState(
  client: SupabaseClient,
  invocationId: string,
  expected: { status: string; degradedReason: string | null },
): Promise<void> {
  const invocation = await client
    .from("ai_invocations")
    .select("status, degraded_reason, completed_at")
    .eq("id", invocationId)
    .single();
  expect(invocation.error).toBeNull();
  expect(invocation.data?.status).toBe(expected.status);
  expect(invocation.data?.degraded_reason).toBe(expected.degradedReason);
  expect(invocation.data?.completed_at).not.toBeNull();
}

async function expectInvocationMissing(
  client: SupabaseClient,
  invocationId: string,
): Promise<void> {
  const invocation = await client
    .from("ai_invocations")
    .select("id")
    .eq("id", invocationId)
    .maybeSingle();
  expect(invocation.error).toBeNull();
  expect(invocation.data).toBeNull();
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
