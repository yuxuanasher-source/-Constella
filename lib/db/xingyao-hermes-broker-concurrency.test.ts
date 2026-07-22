import { spawn, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const container = process.env.HERMES_BROKER_DB_REGRESSION_CONTAINER;

describe.runIf(Boolean(container))(
  "Hermes Broker PostgreSQL lock order",
  () => {
    it("completes beside an exact replay without deadlock or duplicate audit", async () => {
      const dbContainer = container ?? "";
      const userId = "a1111111-1111-4111-8111-111111111111";
      const organizationId = "a2222222-2222-4222-8222-222222222222";
      const conversationId = "a3333333-3333-4333-8333-333333333333";
      const userMessageId = "a4444444-4444-4444-8444-444444444441";
      const assistantMessageId = "a4444444-4444-4444-8444-444444444442";
      const turnId = "a5555555-5555-4555-8555-555555555555";
      const invocationId = "a6666666-6666-4666-8666-666666666666";
      const capabilityId = "a7777777-7777-4777-8777-777777777777";
      const brokerCallId = "a8888888-8888-4888-8888-888888888888";
      const claimOwnerId = "a9999999-9999-4999-8999-999999999999";
      const replayOwnerId = "aa999999-9999-4999-8999-999999999999";
      const cleanupSql = `
        set session_replication_role = replica;
        delete from public.ai_hermes_broker_calls
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_hermes_run_capabilities
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_chat_turns
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_chat_messages
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_conversations
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_invocations
        where organization_id = '${organizationId}'::uuid;
        set session_replication_role = origin;
        delete from public.organization_members
        where organization_id = '${organizationId}'::uuid;
        delete from public.organizations
        where id = '${organizationId}'::uuid;
        delete from public.profiles where id = '${userId}'::uuid;
        delete from auth.users where id = '${userId}'::uuid;
      `;
      const setupSql = `
        ${cleanupSql}
        insert into auth.users (id, email)
        values ('${userId}'::uuid, 'hermes-lock-order@example.invalid');
        insert into public.profiles (id, email, full_name)
        values (
          '${userId}'::uuid,
          'hermes-lock-order@example.invalid',
          'Hermes Lock Order'
        );
        insert into public.organizations (id, name, code)
        values (
          '${organizationId}'::uuid,
          'Hermes Lock Order',
          'hermes-lock-order'
        );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values (
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          'owner',
          'active'
        );
        insert into public.ai_conversations (
          id, organization_id, owner_user_id, title
        ) values (
          '${conversationId}'::uuid,
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          'Hermes Lock Order'
        );
        insert into public.ai_invocations (
          id, organization_id, actor_user_id, scene, status
        ) values (
          '${invocationId}'::uuid,
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          'hermes_lock_order',
          'started'
        );
        insert into public.ai_chat_messages (
          id, organization_id, owner_user_id, conversation_id,
          sequence_no, role, status, content, ai_invocation_id
        ) values
          (
            '${userMessageId}'::uuid,
            '${organizationId}'::uuid,
            '${userId}'::uuid,
            '${conversationId}'::uuid,
            1, 'user', 'completed', 'Search projects', null
          ),
          (
            '${assistantMessageId}'::uuid,
            '${organizationId}'::uuid,
            '${userId}'::uuid,
            '${conversationId}'::uuid,
            2, 'assistant', 'streaming', 'Working',
            '${invocationId}'::uuid
          );
        insert into public.ai_chat_turns (
          id, organization_id, owner_user_id, conversation_id,
          user_message_id, assistant_message_id, mode, status,
          idempotency_key, ai_invocation_id, started_at, lease_expires_at
        ) values (
          '${turnId}'::uuid,
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          '${conversationId}'::uuid,
          '${userMessageId}'::uuid,
          '${assistantMessageId}'::uuid,
          'fast', 'generating', 'hermes-lock-order-turn',
          '${invocationId}'::uuid,
          now(), now() + interval '10 minutes'
        );
        insert into public.ai_hermes_run_capabilities (
          id, token_sha256, organization_id, owner_user_id,
          conversation_id, turn_id, invocation_id, root_invocation_id,
          actor_fingerprint, allowed_tools, allowed_tools_hash,
          scopes, scope_hash, skill_grants_hash, skill_draft_ids,
          depth, ai_state_writes_allowed, expires_at
        ) values (
          '${capabilityId}'::uuid,
          repeat('a', 64),
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          '${conversationId}'::uuid,
          '${turnId}'::uuid,
          '${invocationId}'::uuid,
          '${invocationId}'::uuid,
          repeat('b', 64),
          array['xingyao_search_projects']::text[],
          public.ai_hermes_canonical_text_array_sha256(
            array['xingyao_search_projects']::text[]
          ),
          array['projects.search']::text[],
          public.ai_hermes_canonical_text_array_sha256(
            array['projects.search']::text[]
          ),
          public.ai_hermes_canonical_uuid_array_sha256(array[]::uuid[]),
          array[]::uuid[],
          0, false, now() + interval '10 minutes'
        );
        insert into public.ai_hermes_broker_calls (
          id, capability_id, organization_id, owner_user_id,
          tool_call_id, tool_name, request_sha256,
          sanitized_request_envelope, status, claim_owner_id,
          claim_lease_expires_at, claim_attempt, fencing_token, claimed_at
        ) values (
          '${brokerCallId}'::uuid,
          '${capabilityId}'::uuid,
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          'gateway-deadlock-call',
          'xingyao_search_projects',
          repeat('c', 64),
          '{"toolName":"xingyao_search_projects","arguments":{}}'::jsonb,
          'claimed',
          '${claimOwnerId}'::uuid,
          now() + interval '5 minutes',
          1, 1, now()
        );
      `;
      const blockerSql = `
        begin;
        set local statement_timeout = '5s';
        select id from public.ai_conversations
        where id = '${conversationId}'::uuid for update;
        select pg_catalog.pg_sleep(1.2);
        commit;
      `;
      const completionSql = `
        begin;
        set local deadlock_timeout = '200ms';
        set local statement_timeout = '5s';
        select public.complete_ai_hermes_broker_call(
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          '${brokerCallId}'::uuid,
          '${claimOwnerId}'::uuid,
          1,
          'completed',
          '{"ok":true,"evidenceRefs":["project:project-1"]}'::jsonb,
          null,
          '{"ok":true}'::text,
          '{"toolCallId":"gateway-deadlock-call"}'::jsonb
        );
        commit;
      `;
      const replaySql = `
        begin;
        set local deadlock_timeout = '200ms';
        set local statement_timeout = '5s';
        select public.claim_ai_hermes_broker_call(
          '${organizationId}'::uuid,
          '${userId}'::uuid,
          repeat('a', 64),
          repeat('b', 64),
          '${replayOwnerId}'::uuid,
          'gateway-deadlock-call',
          'xingyao_search_projects',
          repeat('c', 64),
          '{"toolName":"xingyao_search_projects","arguments":{}}'::jsonb
        );
        commit;
      `;

      runSql(dbContainer, setupSql);
      try {
        const blocker = runSqlAsync(dbContainer, blockerSql);
        await delay(200);
        const completion = runSqlAsync(dbContainer, completionSql);
        await delay(200);
        const replay = runSqlAsync(dbContainer, replaySql);
        const results = await withTimeout(
          Promise.all([blocker, completion, replay]),
          8_000,
        );
        const diagnostics = results.map((result) => result.stderr).join("\n");

        expect(diagnostics).not.toContain("40P01");
        for (const result of results) {
          expect(result.code, result.stderr).toBe(0);
        }

        const exactReplay = JSON.parse(
          runSqlText(
            dbContainer,
            `select public.claim_ai_hermes_broker_call(
              '${organizationId}'::uuid,
              '${userId}'::uuid,
              repeat('a', 64),
              repeat('b', 64),
              '${replayOwnerId}'::uuid,
              'gateway-deadlock-call',
              'xingyao_search_projects',
              repeat('c', 64),
              '{"toolName":"xingyao_search_projects","arguments":{}}'::jsonb
            );`,
          ),
        ) as Record<string, unknown>;
        expect(exactReplay).toMatchObject({
          execute: false,
          reused: true,
          status: "completed",
          sanitized_response_envelope: {
            ok: true,
            evidenceRefs: ["project:project-1"],
          },
        });
        expect(
          runSqlText(
            dbContainer,
            `select
              (select count(*) from public.ai_chat_messages
               where conversation_id = '${conversationId}'::uuid
                 and role = 'tool')::text || '|' ||
              (select count(*) from public.ai_hermes_broker_calls
               where id = '${brokerCallId}'::uuid)::text || '|' ||
              (select status from public.ai_hermes_broker_calls
               where id = '${brokerCallId}'::uuid);`,
          ),
        ).toBe("1|1|completed");
      } finally {
        runSql(dbContainer, cleanupSql);
      }
    }, 15_000);
  },
);

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("Hermes DB concurrency timeout")),
        milliseconds,
      ),
    ),
  ]);
}

function runSql(containerName: string, sql: string) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
}

function runSqlText(containerName: string, sql: string) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return result.stdout.trim();
}

function runSqlAsync(
  containerName: string,
  sql: string,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "exec",
        containerName,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-c",
        sql,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}
