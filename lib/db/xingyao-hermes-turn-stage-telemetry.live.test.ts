import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const container = process.env.AI_TURN_STAGE_TELEMETRY_DB_REGRESSION_CONTAINER;
const bashBin = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "bash",
].find((candidate) => candidate === "bash" || existsSync(candidate));

const ids = {
  organization: "a7100000-0000-4000-8000-000000000001",
  owner: "a7100000-0000-4000-8000-000000000002",
  otherOwner: "a7100000-0000-4000-8000-000000000003",
  exact: "a7100000-0000-4000-8000-000000000101",
  idempotent: "a7100000-0000-4000-8000-000000000102",
  reverse: "a7100000-0000-4000-8000-000000000103",
  missing: "a7100000-0000-4000-8000-000000000104",
  invalidOrder: "a7100000-0000-4000-8000-000000000105",
  concurrent: "a7100000-0000-4000-8000-000000000106",
  defaulted: "a7100000-0000-4000-8000-000000000107",
  backfill: "a7100000-0000-4000-8000-000000000108",
  acceptedFallback: "a7100000-0000-4000-8000-000000000109",
  ordinaryUpdate: "a7100000-0000-4000-8000-000000000110",
} as const;

const turnIds = [
  ids.exact,
  ids.idempotent,
  ids.reverse,
  ids.missing,
  ids.invalidOrder,
  ids.concurrent,
  ids.defaulted,
  ids.backfill,
  ids.acceptedFallback,
  ids.ordinaryUpdate,
];
const base = "2026-08-03T16:00:00.000Z";

describe.runIf(Boolean(container))(
  "Xingyao Hermes turn-stage PostgreSQL telemetry",
  () => {
    it("enforces live idempotency, ordering, identity, grants, and concurrency", async () => {
      const dbContainer = container ?? "";
      expect(dbContainer).toMatch(/^supabase_db_[A-Za-z0-9_.-]+$/);

      try {
        seedTurns(dbContainer);

        const beforeBackfill = rowVersion(dbContainer, ids.backfill);
        applyTelemetryBackfill(dbContainer);
        const afterBackfill = rowVersion(dbContainer, ids.backfill);
        expect(
          runSqlText(
            dbContainer,
            `select accepted_at = created_at from public.ai_chat_turns where id = '${ids.backfill}'::uuid;`,
          ),
        ).toBe("t");
        expect(afterBackfill.xmin).not.toBe(beforeBackfill.xmin);
        expect(afterBackfill.updatedAt).toBe(beforeBackfill.updatedAt);

        runSql(
          dbContainer,
          `set session_replication_role = replica;
           update public.ai_chat_turns
           set accepted_at = null
           where id = '${ids.acceptedFallback}'::uuid;
           set session_replication_role = origin;`,
        );
        const beforeAcceptedFallback = rowVersion(
          dbContainer,
          ids.acceptedFallback,
        );
        const acceptedFallback = runRpc(
          dbContainer,
          ids.acceptedFallback,
          "accepted",
          1,
        );
        const afterAcceptedFallback = rowVersion(
          dbContainer,
          ids.acceptedFallback,
        );
        expect(Date.parse(String(acceptedFallback.observedAt))).toBe(
          Date.parse(base),
        );
        expect(
          runSqlText(
            dbContainer,
            `select accepted_at = created_at from public.ai_chat_turns where id = '${ids.acceptedFallback}'::uuid;`,
          ),
        ).toBe("t");
        expect(afterAcceptedFallback.xmin).not.toBe(
          beforeAcceptedFallback.xmin,
        );
        expect(afterAcceptedFallback.updatedAt).toBe(
          beforeAcceptedFallback.updatedAt,
        );

        expect(
          Number(
            runSqlText(
              dbContainer,
              `select pg_column_size(context_snapshot)
               from public.ai_chat_turns
               where id = '${ids.ordinaryUpdate}'::uuid;`,
            ),
          ),
        ).toBeGreaterThan(4 * 1024 * 1024);
        const ordinaryBefore = rowVersion(dbContainer, ids.ordinaryUpdate);
        runRpc(dbContainer, ids.ordinaryUpdate, "context_ready", 1);
        const telemetryOnlyAfter = rowVersion(dbContainer, ids.ordinaryUpdate);
        expect(telemetryOnlyAfter.updatedAt).toBe(ordinaryBefore.updatedAt);
        runSql(
          dbContainer,
          `update public.ai_chat_turns
           set error_code = 'mixed-update',
               session_ready_at = '${base}'::timestamptz + interval '2 minutes'
           where id = '${ids.ordinaryUpdate}'::uuid;`,
        );
        const ordinaryAfter = rowVersion(dbContainer, ids.ordinaryUpdate);
        expect(ordinaryAfter.updatedAt).not.toBe(telemetryOnlyAfter.updatedAt);
        expect(
          runSqlText(
            dbContainer,
            `select error_code from public.ai_chat_turns where id = '${ids.ordinaryUpdate}'::uuid;`,
          ),
        ).toBe("mixed-update");
        const touchTrigger = runSqlText(
          dbContainer,
          `select lower(pg_get_triggerdef(trigger.oid)) || '|' ||
                  lower(pg_get_functiondef(trigger.tgfoid))
           from pg_trigger trigger
           where trigger.tgrelid = 'public.ai_chat_turns'::regclass
             and trigger.tgname = 'ai_chat_turns_touch_updated_at';`,
        );
        expect(touchTrigger).toContain("before update of");
        expect(touchTrigger).toContain("context_snapshot");
        expect(touchTrigger).toContain("error_code");
        expect(touchTrigger).not.toContain("accepted_at");
        expect(touchTrigger).not.toContain("session_ready_at");
        expect(touchTrigger).not.toContain("to_jsonb");
        expect(
          runSqlText(
            dbContainer,
            `select count(*)
             from pg_proc procedure
             join pg_namespace namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = 'preserve_ai_chat_turn_updated_at_for_telemetry';`,
          ),
        ).toBe("0");

        const exact = runRpc(
          dbContainer,
          ids.exact,
          "session_ready",
          3,
          "resumed",
        );
        expect(Object.keys(exact).sort()).toEqual([
          "observedAt",
          "sessionAction",
          "stage",
          "turnId",
        ]);
        expect(exact).toMatchObject({
          turnId: ids.exact,
          stage: "session_ready",
          sessionAction: "resumed",
        });

        const before = rowVersion(dbContainer, ids.idempotent);
        const first = runRpc(dbContainer, ids.idempotent, "context_ready", 2);
        const afterFirst = rowVersion(dbContainer, ids.idempotent);
        const duplicate = runRpc(
          dbContainer,
          ids.idempotent,
          "context_ready",
          3,
        );
        const afterDuplicate = rowVersion(dbContainer, ids.idempotent);
        expect(Date.parse(String(duplicate.observedAt))).toBe(
          Date.parse(String(first.observedAt)),
        );
        expect(afterFirst.xmin).not.toBe(before.xmin);
        expect(afterDuplicate.xmin).toBe(afterFirst.xmin);
        expect(afterFirst.updatedAt).toBe(before.updatedAt);
        expect(afterDuplicate.updatedAt).toBe(before.updatedAt);
        expect(
          runSqlText(
            dbContainer,
            `select accepted_at = created_at from public.ai_chat_turns where id = '${ids.idempotent}'::uuid;`,
          ),
        ).toBe("t");

        for (const [stage, minute, action] of [
          ["persisted", 7],
          ["terminal", 6],
          ["first_delta", 5],
          ["agent_ready", 4],
          ["session_ready", 3, "rebuilt"],
          ["context_ready", 2],
        ] as const) {
          runRpc(dbContainer, ids.reverse, stage, minute, action);
        }
        expect(
          runSqlText(
            dbContainer,
            `select context_ready_at <= session_ready_at
               and session_ready_at <= agent_ready_at
               and agent_ready_at <= first_delta_at
               and first_delta_at <= terminal_at
               and terminal_at <= persisted_at
             from public.ai_chat_turns where id = '${ids.reverse}'::uuid;`,
          ),
        ).toBe("t");

        runRpc(dbContainer, ids.missing, "terminal", 2);
        runRpc(dbContainer, ids.missing, "persisted", 3);
        expect(
          runSqlText(
            dbContainer,
            `select context_ready_at is null and session_ready_at is null
               and terminal_at <= persisted_at
             from public.ai_chat_turns where id = '${ids.missing}'::uuid;`,
          ),
        ).toBe("t");

        const nullStage = runSqlCapture(
          dbContainer,
          rpcSql(ids.exact, "null::text", sqlTimestamp(4), null, true),
        );
        expect(nullStage.code).not.toBe(0);
        expect(nullStage.stderr).toContain("ai_chat_turn_stage_invalid");

        const future = runSqlCapture(
          dbContainer,
          rpcSql(
            ids.exact,
            "'agent_ready'",
            "statement_timestamp() + interval '6 minutes'",
            null,
            true,
          ),
        );
        expect(future.code).not.toBe(0);
        expect(future.stderr).toContain(
          "ai_chat_turn_stage_observed_at_in_future",
        );

        runRpc(dbContainer, ids.invalidOrder, "terminal", 4);
        const inverted = runSqlCapture(
          dbContainer,
          rpcSql(ids.invalidOrder, "'persisted'", sqlTimestamp(3), null, true),
        );
        expect(inverted.code).not.toBe(0);
        expect(inverted.stderr).toContain("ai_chat_turn_stage_before_previous");

        const wrongOwner = runSqlCapture(
          dbContainer,
          rpcSql(
            ids.exact,
            "'agent_ready'",
            sqlTimestamp(4),
            null,
            true,
          ).replace(`'${ids.owner}'::uuid`, `'${ids.otherOwner}'::uuid`),
        );
        expect(wrongOwner.code).not.toBe(0);
        expect(wrongOwner.stderr).toContain(
          "ai_chat_turn_stage_identity_mismatch",
        );

        expect(
          runSqlText(
            dbContainer,
            `select
               has_function_privilege('anon', proc.oid, 'execute') || '|' ||
               has_function_privilege('authenticated', proc.oid, 'execute') || '|' ||
               has_function_privilege('service_role', proc.oid, 'execute')
             from pg_proc proc
             join pg_namespace namespace on namespace.oid = proc.pronamespace
             where namespace.nspname = 'public'
               and proc.proname = 'record_ai_chat_turn_stage';`,
          ),
        ).toBe("false|false|true");
        const denied = runSqlCapture(
          dbContainer,
          `set role authenticated; ${rpcSql(
            ids.defaulted,
            "'accepted'",
            "statement_timestamp()",
            null,
            true,
          )}`,
        );
        expect(denied.code).not.toBe(0);
        expect(denied.stderr.toLowerCase()).toContain("permission denied");
        const serviceAllowed = runSqlCapture(
          dbContainer,
          `set role service_role; ${rpcSql(
            ids.defaulted,
            "'accepted'",
            "statement_timestamp()",
            null,
            true,
          )}`,
        );
        expect(serviceAllowed.code, serviceAllowed.stderr).toBe(0);
        expect(
          runSqlText(
            dbContainer,
            `select accepted_at is not null from public.ai_chat_turns where id = '${ids.defaulted}'::uuid;`,
          ),
        ).toBe("t");

        const concurrentSql = [1, 2].map((minute) =>
          rpcSql(
            ids.concurrent,
            "'context_ready'",
            sqlTimestamp(minute),
            null,
            true,
          ),
        );
        const concurrent = await Promise.all(
          concurrentSql.map((sql) => runSqlAsync(dbContainer, sql)),
        );
        for (const result of concurrent) {
          expect(result.code, result.stderr).toBe(0);
        }
        const concurrentResults = concurrent.map(
          (result) =>
            JSON.parse(result.stdout.trim()) as Record<string, unknown>,
        );
        const storedConcurrent = runSqlText(
          dbContainer,
          `select context_ready_at::text from public.ai_chat_turns where id = '${ids.concurrent}'::uuid;`,
        );
        expect(
          concurrentResults.map((result) =>
            Date.parse(String(result.observedAt)),
          ),
        ).toEqual([Date.parse(storedConcurrent), Date.parse(storedConcurrent)]);
      } finally {
        cleanupTurns(dbContainer);
        cleanupBackfillProgress(dbContainer);
      }
    }, 30_000);
  },
);

function seedTurns(containerName: string) {
  cleanupTurns(containerName);
  const explicitTurns = [
    ids.exact,
    ids.idempotent,
    ids.reverse,
    ids.missing,
    ids.invalidOrder,
    ids.concurrent,
    ids.backfill,
    ids.acceptedFallback,
    ids.ordinaryUpdate,
  ];
  runSql(
    containerName,
    `set session_replication_role = replica;
     insert into public.ai_chat_turns (
       id, organization_id, owner_user_id, conversation_id,
       user_message_id, assistant_message_id, idempotency_key,
       status, created_at, updated_at, accepted_at
     )
     select
       turn_id,
       '${ids.organization}'::uuid,
       '${ids.owner}'::uuid,
       turn_id,
       gen_random_uuid(),
       gen_random_uuid(),
       'telemetry-live-' || turn_id::text,
       'completed',
       '${base}'::timestamptz,
       '2026-01-01T00:00:00Z'::timestamptz,
       case when turn_id = '${ids.backfill}'::uuid
         then null
         else '${base}'::timestamptz
       end
     from unnest(array[${explicitTurns
       .map((id) => `'${id}'::uuid`)
       .join(", ")}]) as turn_id;
     update public.ai_chat_turns
     set context_snapshot = jsonb_build_object(
       'payload',
       (
         select string_agg(md5(value::text), '' order by value)
         from generate_series(1, 131072) value
       )
     )
     where id = '${ids.ordinaryUpdate}'::uuid;
     insert into public.ai_chat_turns (
       id, organization_id, owner_user_id, conversation_id,
       user_message_id, assistant_message_id, idempotency_key,
       status, created_at, updated_at
     ) values (
       '${ids.defaulted}'::uuid,
       '${ids.organization}'::uuid,
       '${ids.owner}'::uuid,
       '${ids.defaulted}'::uuid, gen_random_uuid(), gen_random_uuid(),
       'telemetry-live-${ids.defaulted}', 'completed',
       statement_timestamp(), '2026-01-01T00:00:00Z'::timestamptz
     );
     set session_replication_role = origin;`,
  );
}

function applyTelemetryBackfill(containerName: string) {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260803120500_ai_turn_stage_telemetry_backfill.sql",
    ),
    "utf8",
  );
  runSql(
    containerName,
    `begin;
     set local jingying.deploy_control_capability =
       'ai-turn-telemetry-batched-backfill-v1';
     ${migration}
     commit;`,
  );
  runSql(
    containerName,
    `alter table public.ai_chat_turns
       drop constraint ai_chat_turns_session_action_check;
     alter table public.ai_chat_turns
       add constraint ai_chat_turns_session_action_check check (
         session_action is null or session_action in ('resumed', 'rebuilt')
       ) not valid;`,
  );
  const deployScript = shellPath(join(process.cwd(), "scripts", "deploy.sh"));
  const result = spawnSync(
    bashBin ?? "bash",
    [
      "-c",
      [
        "set -Eeuo pipefail",
        `export DB_CONTAINER=${shellQuote(containerName)}`,
        "export DB_NAME=postgres",
        `source ${shellQuote(deployScript)}`,
        "emit_internal_ledger_security_sql | db -Atq",
        `db -Atqc ${shellQuote(
          "delete from deploy_internal.backfill_progress where task_name = 'ai_turn_stage_telemetry_accepted_at_v1'",
        )}`,
        "DB_LEASE_ACTIVE=1",
        "assert_database_deploy_lease() { :; }",
        "run_ai_turn_stage_telemetry_backfill",
      ].join("\n"),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || "telemetry backfill failed",
    );
  }
}

function shellPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (process.platform !== "win32") return normalized;
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cleanupBackfillProgress(containerName: string) {
  runSql(
    containerName,
    `do $$
     begin
       if to_regclass('deploy_internal.backfill_progress') is not null then
         execute $cleanup$
           delete from deploy_internal.backfill_progress
           where task_name = 'ai_turn_stage_telemetry_accepted_at_v1'
         $cleanup$;
       end if;
     end
     $$;`,
  );
}

function cleanupTurns(containerName: string) {
  runSql(
    containerName,
    `set session_replication_role = replica;
     delete from public.ai_chat_turns
     where id = any(array[${turnIds.map((id) => `'${id}'::uuid`).join(", ")}]);
     set session_replication_role = origin;`,
  );
}

function runRpc(
  containerName: string,
  turnId: string,
  stage: string,
  minute: number,
  action?: string,
) {
  return JSON.parse(
    runSqlText(
      containerName,
      rpcSql(
        turnId,
        `'${stage}'`,
        sqlTimestamp(minute),
        action ? `'${action}'` : null,
        true,
      ),
    ),
  ) as Record<string, unknown>;
}

function rpcSql(
  turnId: string,
  stageSql: string,
  observedAtSql: string,
  actionSql: string | null,
  includeSemicolon: boolean,
) {
  return `select public.record_ai_chat_turn_stage(
    '${ids.organization}'::uuid,
    '${ids.owner}'::uuid,
    '${turnId}'::uuid,
    '${turnId}'::uuid,
    ${stageSql},
    ${observedAtSql},
    ${actionSql ?? "null::text"}
  )::text${includeSemicolon ? ";" : ""}`;
}

function sqlTimestamp(minute: number) {
  return `'${base}'::timestamptz + interval '${minute} minutes'`;
}

function rowVersion(containerName: string, turnId: string) {
  const [xmin, updatedAt] = runSqlText(
    containerName,
    `select xmin::text || '|' || updated_at::text
     from public.ai_chat_turns where id = '${turnId}'::uuid;`,
  ).split("|");
  return { xmin, updatedAt };
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
