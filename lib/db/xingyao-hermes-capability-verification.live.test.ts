import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

const container = process.env.HERMES_CAPABILITY_VERIFICATION_DB_CONTAINER;
const enabled = process.env.RUN_HERMES_CAPABILITY_VERIFICATION_LIVE === "1";

if (enabled && !container) {
  throw new Error(
    "RUN_HERMES_CAPABILITY_VERIFICATION_LIVE=1 requires HERMES_CAPABILITY_VERIFICATION_DB_CONTAINER",
  );
}
if (enabled && !/^supabase_db_[A-Za-z0-9_.-]+$/.test(container ?? "")) {
  throw new Error(
    "HERMES_CAPABILITY_VERIFICATION_DB_CONTAINER must name a local Supabase database container",
  );
}

describe.runIf(enabled)("Hermes capability verification PostgreSQL RPC", () => {
  it("verifies depth 0, 1, and 2 lineages with minimal results and service-only grants", () => {
    const fixture = createFixture();
    seedFixture(container ?? "", fixture);

    try {
      for (const [depth, capability] of fixture.capabilities.entries()) {
        const result = verifyCapability(
          container ?? "",
          capability.tokenSha256,
        );
        expect(Object.keys(result).sort()).toEqual([
          "actor_fingerprint",
          "conversation_id",
          "expires_at",
          "invocation_id",
          "organization_id",
          "owner_user_id",
          "revoked_at",
        ]);
        expect(result).toMatchObject({
          organization_id: fixture.organizationId,
          owner_user_id: fixture.userId,
          conversation_id: fixture.conversationId,
          invocation_id: fixture.invocationIds[depth],
          actor_fingerprint: fixture.actorFingerprint,
          revoked_at: null,
        });
        expect(Date.parse(String(result.expires_at))).toBeGreaterThan(
          Date.now(),
        );
      }

      expect(
        runSqlText(
          container ?? "",
          `select
             has_function_privilege('anon', procedure.oid, 'execute') || '|' ||
             has_function_privilege('authenticated', procedure.oid, 'execute') || '|' ||
             has_function_privilege('service_role', procedure.oid, 'execute')
           from pg_proc procedure
           join pg_namespace namespace on namespace.oid = procedure.pronamespace
           where namespace.nspname = 'public'
             and procedure.proname = 'verify_ai_hermes_invocation_capability';`,
        ),
      ).toBe("false|false|true");

      for (const role of ["anon", "authenticated"]) {
        const denied = runSqlCapture(
          container ?? "",
          `set role ${role}; ${verificationSql(fixture.capabilities[0].tokenSha256)}`,
        );
        expect(denied.code).not.toBe(0);
        expect(denied.stderr.toLowerCase()).toContain("permission denied");
      }
      const serviceAllowed = runSqlCapture(
        container ?? "",
        `set role service_role; ${verificationSql(fixture.capabilities[2].tokenSha256)}`,
      );
      expect(serviceAllowed.code, serviceAllowed.stderr).toBe(0);
    } finally {
      cleanupFixture(container ?? "", fixture);
    }
  });

  it("rejects inactive ledgers, terminal invocations, and revoked or expired lineage", () => {
    const fixture = createFixture();
    const dbContainer = container ?? "";
    const leafHash = fixture.capabilities[2].tokenSha256;
    seedFixture(dbContainer, fixture);

    try {
      rejectAfterMutation(
        dbContainer,
        fixture,
        `update public.ai_conversations set status = 'archived'
         where id = '${fixture.conversationId}'::uuid;`,
        `update public.ai_conversations set status = 'active'
         where id = '${fixture.conversationId}'::uuid;`,
      );
      rejectAfterMutation(
        dbContainer,
        fixture,
        `update public.ai_chat_turns
         set lease_expires_at = clock_timestamp() - interval '1 minute'
         where id = '${fixture.turnId}'::uuid;`,
        `update public.ai_chat_turns
         set lease_expires_at = clock_timestamp() + interval '10 minutes'
         where id = '${fixture.turnId}'::uuid;`,
      );
      rejectAfterMutation(
        dbContainer,
        fixture,
        `update public.ai_chat_turns set status = 'completed', outcome = 'complete'
         where id = '${fixture.turnId}'::uuid;`,
        `set session_replication_role = replica;
         update public.ai_chat_turns
         set status = 'generating', outcome = null,
             lease_expires_at = clock_timestamp() + interval '10 minutes'
         where id = '${fixture.turnId}'::uuid;
         update public.ai_invocations
         set status = 'started', completed_at = null
         where id = '${fixture.invocationIds[0]}'::uuid;
         update public.ai_hermes_run_capabilities set revoked_at = null
         where organization_id = '${fixture.organizationId}'::uuid;
         set session_replication_role = origin;`,
      );

      for (const status of ["succeeded", "failed"]) {
        rejectAfterMutation(
          dbContainer,
          fixture,
          `update public.ai_invocations set status = '${status}'
           where id = '${fixture.invocationIds[2]}'::uuid;`,
          `set session_replication_role = replica;
           update public.ai_invocations
           set status = 'started', completed_at = null
           where id = '${fixture.invocationIds[2]}'::uuid;
           update public.ai_hermes_run_capabilities set revoked_at = null
           where organization_id = '${fixture.organizationId}'::uuid;
           set session_replication_role = origin;`,
        );
      }

      for (const capabilityIndex of [2, 0]) {
        const capabilityId = fixture.capabilities[capabilityIndex].id;
        rejectAfterMutation(
          dbContainer,
          fixture,
          `update public.ai_hermes_run_capabilities
           set revoked_at = clock_timestamp()
           where id = '${capabilityId}'::uuid;`,
          `update public.ai_hermes_run_capabilities set revoked_at = null
           where id = '${capabilityId}'::uuid;`,
        );
        rejectAfterMutation(
          dbContainer,
          fixture,
          `update public.ai_hermes_run_capabilities
           set expires_at = clock_timestamp() - interval '1 second'
           where id = '${capabilityId}'::uuid;`,
          `update public.ai_hermes_run_capabilities
           set expires_at = clock_timestamp() + interval '8 minutes'
           where id = '${capabilityId}'::uuid;`,
        );
      }

      expect(verifyCapability(dbContainer, leafHash)).toMatchObject({
        invocation_id: fixture.invocationIds[2],
        revoked_at: null,
      });
    } finally {
      cleanupFixture(dbContainer, fixture);
    }
  }, 30_000);

  it("serializes ancestor revocation and turn completion without deadlock", async () => {
    const dbContainer = container ?? "";

    for (const race of ["ancestor-revocation", "turn-completion"] as const) {
      const fixture = createFixture();
      seedFixture(dbContainer, fixture);

      try {
        const mutation =
          race === "ancestor-revocation"
            ? `update public.ai_hermes_run_capabilities
               set revoked_at = clock_timestamp()
               where id = '${fixture.capabilities[0].id}'::uuid;`
            : `update public.ai_chat_turns
               set status = 'completed', outcome = 'complete',
                   completed_at = clock_timestamp()
               where id = '${fixture.turnId}'::uuid;`;
        const blockerSql = `begin;
          set local deadlock_timeout = '200ms';
          set local statement_timeout = '5s';
          ${canonicalLockSql(fixture)}
          ${mutation}
          select pg_catalog.pg_sleep(1.2);
          commit;`;
        const verifierSql = `begin;
          set local deadlock_timeout = '200ms';
          set local statement_timeout = '5s';
          ${verificationSql(fixture.capabilities[2].tokenSha256)}
          commit;`;

        const blocker = runSqlAsync(dbContainer, blockerSql);
        await delay(200);
        const startedAt = Date.now();
        const verifier = runSqlAsync(dbContainer, verifierSql);
        const [blockerResult, verifierResult] = await withTimeout(
          Promise.all([blocker, verifier]),
          8_000,
        );
        const verifierElapsedMs = Date.now() - startedAt;
        const diagnostics = `${blockerResult.stderr}\n${verifierResult.stderr}`;

        expect(diagnostics).not.toContain("40P01");
        expect(blockerResult.code, blockerResult.stderr).toBe(0);
        expect(verifierResult.code).not.toBe(0);
        expect(verifierResult.stderr).toContain("capability_invalid");
        expect(verifierElapsedMs).toBeGreaterThanOrEqual(800);
        expect(verifierElapsedMs).toBeLessThan(5_000);
      } finally {
        cleanupFixture(dbContainer, fixture);
      }
    }
  }, 30_000);
});

type Fixture = ReturnType<typeof createFixture>;

function createFixture() {
  const suffix = randomUUID();
  const invocationIds = [randomUUID(), randomUUID(), randomUUID()];
  return {
    userId: randomUUID(),
    organizationId: randomUUID(),
    conversationId: randomUUID(),
    userMessageId: randomUUID(),
    assistantMessageId: randomUUID(),
    turnId: randomUUID(),
    invocationIds,
    actorFingerprint: sha256(`actor:${suffix}`),
    capabilities: invocationIds.map((invocationId, depth) => ({
      id: randomUUID(),
      invocationId,
      tokenSha256: sha256(`capability:${depth}:${suffix}`),
      depth,
    })),
    suffix,
  };
}

function seedFixture(containerName: string, fixture: Fixture) {
  runSql(
    containerName,
    `insert into auth.users (id, email)
     values ('${fixture.userId}'::uuid, 'capability-${fixture.suffix}@example.invalid');
     insert into public.profiles (id, email, full_name)
     values (
       '${fixture.userId}'::uuid,
       'capability-${fixture.suffix}@example.invalid',
       'Hermes Capability Verification'
     );
     insert into public.organizations (id, name, code)
     values (
       '${fixture.organizationId}'::uuid,
       'Hermes Capability Verification',
       'capability-${fixture.suffix}'
     );
     insert into public.organization_members (
       organization_id, user_id, role, status
     ) values (
       '${fixture.organizationId}'::uuid,
       '${fixture.userId}'::uuid,
       'owner', 'active'
     );
     insert into public.ai_conversations (
       id, organization_id, owner_user_id, title, status
     ) values (
       '${fixture.conversationId}'::uuid,
       '${fixture.organizationId}'::uuid,
       '${fixture.userId}'::uuid,
       'Capability verification live test', 'active'
     );
     insert into public.ai_invocations (
       id, organization_id, actor_user_id, scene, status
     ) values
       ('${fixture.invocationIds[0]}'::uuid, '${fixture.organizationId}'::uuid,
        '${fixture.userId}'::uuid, 'capability_verify_root', 'started'),
       ('${fixture.invocationIds[1]}'::uuid, '${fixture.organizationId}'::uuid,
        '${fixture.userId}'::uuid, 'capability_verify_child', 'started'),
       ('${fixture.invocationIds[2]}'::uuid, '${fixture.organizationId}'::uuid,
        '${fixture.userId}'::uuid, 'capability_verify_grandchild', 'started');
     insert into public.ai_chat_messages (
       id, organization_id, owner_user_id, conversation_id,
       sequence_no, role, status, content, ai_invocation_id
     ) values
       ('${fixture.userMessageId}'::uuid, '${fixture.organizationId}'::uuid,
        '${fixture.userId}'::uuid, '${fixture.conversationId}'::uuid,
        1, 'user', 'completed', 'Verify capability', null),
       ('${fixture.assistantMessageId}'::uuid, '${fixture.organizationId}'::uuid,
        '${fixture.userId}'::uuid, '${fixture.conversationId}'::uuid,
        2, 'assistant', 'streaming', 'Working',
        '${fixture.invocationIds[0]}'::uuid);
     insert into public.ai_chat_turns (
       id, organization_id, owner_user_id, conversation_id,
       user_message_id, assistant_message_id, mode, status,
       idempotency_key, ai_invocation_id, started_at, lease_expires_at
     ) values (
       '${fixture.turnId}'::uuid, '${fixture.organizationId}'::uuid,
       '${fixture.userId}'::uuid, '${fixture.conversationId}'::uuid,
       '${fixture.userMessageId}'::uuid, '${fixture.assistantMessageId}'::uuid,
       'deep', 'generating', 'capability-${fixture.suffix}',
       '${fixture.invocationIds[0]}'::uuid,
       clock_timestamp(), clock_timestamp() + interval '10 minutes'
     );
     insert into public.ai_hermes_run_capabilities (
       id, token_sha256, organization_id, owner_user_id,
       conversation_id, turn_id, invocation_id, root_invocation_id,
       parent_capability_id, parent_invocation_id, actor_fingerprint,
       allowed_tools, allowed_tools_hash, scopes, scope_hash,
       skill_grants_hash, skill_draft_ids, depth,
       ai_state_writes_allowed, memory_snapshot_at,
       memory_snapshot_generation, expires_at
     )
     select
       capability_id, token_hash, '${fixture.organizationId}'::uuid,
       '${fixture.userId}'::uuid, '${fixture.conversationId}'::uuid,
       '${fixture.turnId}'::uuid, invocation_id,
       '${fixture.invocationIds[0]}'::uuid, parent_capability_id,
       parent_invocation_id, '${fixture.actorFingerprint}',
       array['xingyao_search_projects']::text[],
       public.ai_hermes_canonical_text_array_sha256(
         array['xingyao_search_projects']::text[]
       ),
       array['projects.search']::text[],
       public.ai_hermes_canonical_text_array_sha256(
         array['projects.search']::text[]
       ),
       public.ai_hermes_canonical_uuid_array_sha256(array[]::uuid[]),
       array[]::uuid[], depth, depth = 0,
       turn.memory_snapshot_at, turn.memory_snapshot_generation,
       clock_timestamp() + make_interval(mins => 10 - depth)
     from (
       values
         ('${fixture.capabilities[0].id}'::uuid,
          '${fixture.capabilities[0].tokenSha256}',
          '${fixture.invocationIds[0]}'::uuid, null::uuid, null::uuid, 0),
         ('${fixture.capabilities[1].id}'::uuid,
          '${fixture.capabilities[1].tokenSha256}',
          '${fixture.invocationIds[1]}'::uuid,
          '${fixture.capabilities[0].id}'::uuid,
          '${fixture.invocationIds[0]}'::uuid, 1),
         ('${fixture.capabilities[2].id}'::uuid,
          '${fixture.capabilities[2].tokenSha256}',
          '${fixture.invocationIds[2]}'::uuid,
          '${fixture.capabilities[1].id}'::uuid,
          '${fixture.invocationIds[1]}'::uuid, 2)
     ) as capability(
       capability_id, token_hash, invocation_id,
       parent_capability_id, parent_invocation_id, depth
     )
     cross join public.ai_chat_turns turn
     where turn.id = '${fixture.turnId}'::uuid
     order by depth;`,
  );
}

function rejectAfterMutation(
  containerName: string,
  fixture: Fixture,
  mutationSql: string,
  restoreSql: string,
) {
  runSql(containerName, mutationSql);
  try {
    const rejected = runSqlCapture(
      containerName,
      verificationSql(fixture.capabilities[2].tokenSha256),
    );
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("capability_invalid");
  } finally {
    runSql(containerName, restoreSql);
  }
}

function verifyCapability(containerName: string, tokenSha256: string) {
  return JSON.parse(
    runSqlText(
      containerName,
      `select row_to_json(binding)::text
       from public.verify_ai_hermes_invocation_capability(
         '${tokenSha256}'
       ) binding;`,
    ),
  ) as Record<string, unknown>;
}

function verificationSql(tokenSha256: string) {
  return `select * from public.verify_ai_hermes_invocation_capability('${tokenSha256}');`;
}

function canonicalLockSql(fixture: Fixture) {
  const invocationIds = fixture.invocationIds
    .map((id) => `'${id}'::uuid`)
    .join(", ");
  const capabilityIds = fixture.capabilities
    .map((capability) => `'${capability.id}'::uuid`)
    .join(", ");
  return `select id from public.ai_conversations
          where id = '${fixture.conversationId}'::uuid for update;
          select id from public.ai_chat_turns
          where id = '${fixture.turnId}'::uuid for update;
          select id from public.ai_invocations
          where id = any(array[${invocationIds}])
          order by id for update;
          select id from public.ai_hermes_run_capabilities
          where id = any(array[${capabilityIds}])
          order by id for update;`;
}

function cleanupFixture(containerName: string, fixture: Fixture) {
  runSql(
    containerName,
    `set session_replication_role = replica;
     delete from public.ai_hermes_run_capabilities
     where organization_id = '${fixture.organizationId}'::uuid;
     delete from public.ai_chat_turns
     where organization_id = '${fixture.organizationId}'::uuid;
     delete from public.ai_chat_messages
     where organization_id = '${fixture.organizationId}'::uuid;
     delete from public.ai_conversations
     where organization_id = '${fixture.organizationId}'::uuid;
     delete from public.ai_invocations
     where organization_id = '${fixture.organizationId}'::uuid;
     delete from public.ai_hermes_memory_owner_clocks
     where organization_id = '${fixture.organizationId}'::uuid;
     set session_replication_role = origin;
     delete from public.organization_members
     where organization_id = '${fixture.organizationId}'::uuid;
     delete from public.organizations
     where id = '${fixture.organizationId}'::uuid;
     delete from public.profiles where id = '${fixture.userId}'::uuid;
     delete from auth.users where id = '${fixture.userId}'::uuid;`,
  );
  expect(
    runSqlText(
      containerName,
      `select
         (select count(*) from public.ai_hermes_run_capabilities
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.ai_chat_turns
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.ai_chat_messages
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.ai_conversations
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.ai_invocations
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.ai_hermes_memory_owner_clocks
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.organization_members
          where organization_id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.organizations
          where id = '${fixture.organizationId}'::uuid) || '|' ||
         (select count(*) from public.profiles
          where id = '${fixture.userId}'::uuid) || '|' ||
         (select count(*) from auth.users
          where id = '${fixture.userId}'::uuid);`,
    ),
  ).toBe("0|0|0|0|0|0|0|0|0|0");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function runSql(containerName: string, sql: string) {
  const result = runSqlCapture(containerName, sql);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
}

function runSqlText(containerName: string, sql: string) {
  const result = runSqlCapture(containerName, sql);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result.stdout.trim();
}

function psqlArgs(containerName: string) {
  return [
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-At",
  ];
}

function runSqlCapture(containerName: string, sql: string) {
  const result = spawnSync("docker", psqlArgs(containerName), {
    input: sql,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function runSqlAsync(containerName: string, sql: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn("docker", psqlArgs(containerName), {
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(sql);
    },
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`database race exceeded ${milliseconds}ms`)),
        milliseconds,
      );
    }),
  ]);
}
