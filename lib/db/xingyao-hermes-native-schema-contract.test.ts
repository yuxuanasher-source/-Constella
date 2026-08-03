import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260722100000_xingyao_hermes_native_state.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const telemetryMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260803120000_ai_turn_stage_telemetry.sql",
);
const telemetryMigration = existsSync(telemetryMigrationPath)
  ? readFileSync(telemetryMigrationPath, "utf8").toLowerCase()
  : "";
const telemetryBackfillMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260803120500_ai_turn_stage_telemetry_backfill.sql",
);
const telemetryBackfillMigration = existsSync(telemetryBackfillMigrationPath)
  ? readFileSync(telemetryBackfillMigrationPath, "utf8").toLowerCase()
  : "";
const capabilityVerificationMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260803121000_ai_hermes_capability_verification.sql",
);
const capabilityVerificationMigration = existsSync(
  capabilityVerificationMigrationPath,
)
  ? readFileSync(capabilityVerificationMigrationPath, "utf8").toLowerCase()
  : "";
const structuredMemoryMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260803130000_ai_conversation_structured_memory.sql",
);
const structuredMemoryMigration = existsSync(structuredMemoryMigrationPath)
  ? readFileSync(structuredMemoryMigrationPath, "utf8").toLowerCase()
  : "";
const structuredMemoryDbContainer =
  process.env.HERMES_STRUCTURED_MEMORY_DB_REGRESSION_CONTAINER;

function tableSql(tableName: string) {
  const marker = `create table public.${tableName} (`;
  const start = migration.indexOf(marker);
  if (start < 0) return "";
  const end = migration.indexOf("\n);", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 3);
}

function functionSql(functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = migration.indexOf(marker);
  if (start < 0) return "";
  const end = migration.indexOf("\n$$;", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 4);
}

function telemetryFunctionSql(functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = telemetryMigration.indexOf(marker);
  if (start < 0) return "";
  const end = telemetryMigration.indexOf("\n$$;", start);
  return end < 0
    ? telemetryMigration.slice(start)
    : telemetryMigration.slice(start, end + 4);
}

function capabilityVerificationFunctionSql(functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = capabilityVerificationMigration.indexOf(marker);
  if (start < 0) return "";
  const end = capabilityVerificationMigration.indexOf("\n$$;", start);
  return end < 0
    ? capabilityVerificationMigration.slice(start)
    : capabilityVerificationMigration.slice(start, end + 4);
}

function structuredMemoryFunctionSql(functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = structuredMemoryMigration.indexOf(marker);
  if (start < 0) return "";
  const end = structuredMemoryMigration.indexOf("\n$$;", start);
  return end < 0
    ? structuredMemoryMigration.slice(start)
    : structuredMemoryMigration.slice(start, end + 4);
}

function expectSqlOrder(sql: string, markers: string[]) {
  const positions = markers.map((marker) => sql.indexOf(marker));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
}

const serviceOnlyFunctions = [
  "issue_ai_hermes_run_capability",
  "claim_ai_hermes_broker_call",
  "complete_ai_hermes_broker_call",
  "append_ai_hermes_tool_message",
  "update_ai_conversation_hermes_state",
  "load_ai_hermes_memory_snapshot",
  "complete_ai_hermes_memory_broker_call",
  "write_ai_hermes_memory_revision",
  "forget_ai_hermes_memory",
  "write_ai_hermes_skill_draft",
  "review_ai_hermes_skill_draft",
  "cancel_ai_chat_turn",
  "claim_ai_conversation_clarify_response",
  "renew_ai_chat_turn_lease",
  "finish_ai_chat_turn_v2",
] as const;

describe("Xingyao Hermes native state schema contract", () => {
  it("adds bounded structured-memory state and one pending job per conversation version", () => {
    expect(existsSync(structuredMemoryMigrationPath)).toBe(true);
    expect(structuredMemoryMigration.split(/\r?\n/)[0]).toBe(
      "-- deploy: expand",
    );
    expect(structuredMemoryMigration).toContain(
      "add column if not exists memory_status text not null default 'ready'",
    );
    expect(structuredMemoryMigration).toContain(
      "add column if not exists memory_degraded_at timestamptz",
    );
    expect(structuredMemoryMigration).toContain(
      "create table if not exists public.ai_conversation_memory_jobs",
    );
    expect(structuredMemoryMigration).toContain(
      "check (status in ('pending', 'completed'))",
    );
    expect(structuredMemoryMigration).toMatch(
      /create unique index[^;]+on public\.ai_conversation_memory_jobs \(conversation_id, target_summary_version\)[\s\S]+where status = 'pending'/,
    );
    expect(structuredMemoryMigration).toContain(
      "check (memory_status in ('ready', 'degraded'))",
    );
  });

  it("finishes the response atomically and degrades only the memory savepoint", () => {
    const finishV3 = structuredMemoryFunctionSql("finish_ai_chat_turn_v3");

    expect(finishV3).toContain("security definer");
    expect(finishV3).toContain("set search_path = pg_catalog, public");
    expect(finishV3).toContain("public.finish_ai_chat_turn_v2(");
    expect(finishV3).toContain("if not v_terminal_completed then");
    expect(finishV3).toContain("jsonb_object_keys(p_memory_delta)");
    expect(finishV3).toContain("jsonb_array_length");
    expect(finishV3).toContain(
      "source_message.conversation_id = v_conversation_id",
    );
    expect(finishV3).toContain("source_message.status = 'completed'");
    expect(finishV3).toContain(
      "source_message.sequence_no <= v_through_sequence",
    );
    expect(finishV3).toContain("summary_version = p_expected_summary_version");
    expect(finishV3).toContain("summary_version = summary_version + 1");
    expect(finishV3).toContain("exception when others then");
    expectSqlOrder(finishV3, [
      "public.finish_ai_chat_turn_v2(",
      "begin\n    if p_memory_delta is null",
      "summary_version = summary_version + 1",
      "exception when others then",
      "memory_status = 'degraded'",
      "insert into public.ai_conversation_memory_jobs",
    ]);
    expect(finishV3).toContain(
      "on conflict (conversation_id, target_summary_version)",
    );
    expect(finishV3).toContain("return jsonb_build_object(");
  });

  it("keeps v3 terminal persistence service-only", () => {
    expect(structuredMemoryMigration).toMatch(
      /revoke all on function public\.finish_ai_chat_turn_v3\([\s\S]*?from public, anon, authenticated;/,
    );
    expect(structuredMemoryMigration).toMatch(
      /grant execute on function public\.finish_ai_chat_turn_v3\([\s\S]*?to service_role;/,
    );
    expect(structuredMemoryMigration).not.toMatch(
      /grant execute on function public\.finish_ai_chat_turn_v3\([\s\S]*?to (anon|authenticated);/,
    );
  });

  it("verifies invocation capabilities atomically under the canonical lock order", () => {
    expect(existsSync(capabilityVerificationMigrationPath)).toBe(true);
    expect(capabilityVerificationMigration.split(/\r?\n/)[0]).toBe(
      "-- deploy: expand",
    );
    expect(capabilityVerificationMigration).not.toContain("drop function");
    const verifyCapability = capabilityVerificationFunctionSql(
      "verify_ai_hermes_invocation_capability",
    );

    expect(verifyCapability).toContain("security definer");
    expect(verifyCapability).toContain("set search_path = pg_catalog, public");
    expect(verifyCapability).toContain(
      "lower(coalesce(p_token_sha256, '')) !~ '^[0-9a-f]{64}$'",
    );
    expect(verifyCapability).not.toContain("p_capability_token");
    expectSqlOrder(verifyCapability, [
      "from public.ai_conversations locked_conversation",
      "from public.ai_chat_turns locked_turn",
      "from public.ai_invocations locked_invocation",
      "perform public.lock_and_validate_ai_hermes_capability_lineage(",
      "from public.ai_hermes_run_capabilities locked_capability",
    ]);
    expect(verifyCapability).toContain("locked_conversation.status = 'active'");
    expect(verifyCapability).toContain(
      "locked_turn.status in ('accepted', 'grounding', 'generating', 'validating')",
    );
    expect(verifyCapability).toContain(
      "locked_turn.lease_expires_at > clock_timestamp()",
    );
    expect(verifyCapability).toContain(
      "locked_turn.cancel_requested_at is null",
    );
    expect(verifyCapability).toContain(
      "locked_turn.ai_invocation_id = v_capability.root_invocation_id",
    );
    expect(verifyCapability).toContain(
      "locked_invocation.status in ('started', 'queued')",
    );
    expect(verifyCapability).toContain(
      "v_locked_invocation_count <> v_capability.depth + 1",
    );
    expect(verifyCapability).toContain(
      "v_final_lineage_ids is distinct from v_discovered_lineage_ids",
    );
    expect(verifyCapability).toContain(
      "v_final_invocation_ids is distinct from v_discovered_invocation_ids",
    );
    expect(verifyCapability).toMatch(
      /lineage_capability\.revoked_at is not null[\s\S]*?lineage_capability\.expires_at <= clock_timestamp\(\)/,
    );
    expect(verifyCapability).toContain(
      "locked_capability.token_sha256 = lower(p_token_sha256)",
    );
    expect(verifyCapability).toContain("locked_capability.revoked_at is null");
    expect(verifyCapability).toContain(
      "locked_capability.expires_at > clock_timestamp()",
    );
  });

  it("returns only Gateway's sanitized binding and grants execution only to service_role", () => {
    const verifyCapability = capabilityVerificationFunctionSql(
      "verify_ai_hermes_invocation_capability",
    );
    const signature = "public.verify_ai_hermes_invocation_capability(text)";

    expect(verifyCapability).toMatch(
      /returns table \(\s*organization_id uuid,\s*owner_user_id uuid,\s*conversation_id uuid,\s*invocation_id uuid,\s*actor_fingerprint text,\s*expires_at timestamptz,\s*revoked_at timestamptz\s*\)/,
    );
    for (const forbidden of [
      "token_sha256 text,",
      "turn_id uuid,",
      "root_invocation_id uuid,",
      "parent_capability_id uuid,",
      "skill_grants_hash text,",
    ]) {
      expect(verifyCapability).not.toContain(forbidden);
    }
    expect(capabilityVerificationMigration).toContain(
      `revoke all on function ${signature} from public, anon, authenticated;`,
    );
    expect(capabilityVerificationMigration).toContain(
      `grant execute on function ${signature} to service_role;`,
    );
    expect(capabilityVerificationMigration).not.toMatch(
      /grant execute on function public\.verify_ai_hermes_invocation_capability\(text\) to (public|anon|authenticated)/,
    );
  });

  it("adds nullable, first-write turn-stage telemetry without replacing terminal persistence", () => {
    expect(existsSync(telemetryMigrationPath)).toBe(true);
    expect(telemetryMigration.split(/\r?\n/)[0]).toBe("-- deploy: expand");
    for (const column of [
      "accepted_at",
      "context_ready_at",
      "session_ready_at",
      "agent_ready_at",
      "first_delta_at",
      "terminal_at",
      "persisted_at",
    ]) {
      expect(telemetryMigration).toContain(
        `add column if not exists ${column} timestamptz`,
      );
    }
    expect(telemetryMigration).toContain(
      "add column if not exists session_action text",
    );
    expect(telemetryMigration).toMatch(
      /constraint ai_chat_turns_session_action_check check \(\s*session_action is null or session_action in \('resumed', 'rebuilt'\)\s*\) not valid/,
    );
    expectSqlOrder(telemetryMigration, [
      "add column if not exists accepted_at timestamptz",
      "alter column accepted_at set default now()",
    ]);
    expect(telemetryMigration).not.toMatch(
      /update public\.ai_chat_turns\s+set accepted_at = created_at/,
    );
    expect(telemetryMigration).not.toContain(
      "create or replace function public.finish_ai_chat_turn_v2(",
    );
  });

  it("keeps historical backfill transaction control out of the expand migration", () => {
    expect(existsSync(telemetryBackfillMigrationPath)).toBe(true);
    expect(telemetryBackfillMigration.split(/\r?\n/)[0]).toBe(
      "-- deploy: expand",
    );
    expect(telemetryBackfillMigration).toContain(
      "scripts/deploy.sh backfills accepted_at in separately committed batches",
    );
    expect(telemetryBackfillMigration).not.toMatch(/\bdo\s+\$\$/);
    expect(telemetryBackfillMigration).not.toContain(
      "update public.ai_chat_turns",
    );
    expect(telemetryBackfillMigration).not.toContain("validate constraint");
  });

  it("records tenant-bound stages under a lock with strict monotonic timestamps", () => {
    const recordStage = telemetryFunctionSql("record_ai_chat_turn_stage");

    expect(recordStage).toContain("security definer");
    expect(recordStage).toContain("set search_path = pg_catalog, public");
    for (const identity of [
      "locked_turn.organization_id = p_organization_id",
      "locked_turn.owner_user_id = p_owner_user_id",
      "locked_turn.conversation_id = p_conversation_id",
      "locked_turn.id = p_turn_id",
    ]) {
      expect(recordStage).toContain(identity);
    }
    expect(recordStage).toMatch(
      /from public\.ai_chat_turns (?:as )?locked_turn[\s\S]*?for update/,
    );
    expect(recordStage).toContain("p_observed_at is null");
    expect(recordStage).toContain(
      "statement_timestamp() + interval '5 minutes'",
    );
    expect(recordStage).not.toContain("interval '5 seconds'");
    expect(recordStage).toMatch(
      /v_previous is not null\s+and v_candidate < v_previous then/,
    );
    expect(recordStage).toMatch(
      /v_next is not null\s+and v_candidate > v_next then/,
    );
    expect(recordStage).toContain("v_effective_accepted_at is null");
    expect(recordStage).toContain("p_stage in ('terminal', 'persisted')");
    expect(recordStage).toMatch(
      /p_stage not in \(\s*'accepted',\s*'context_ready',\s*'session_ready',\s*'agent_ready',\s*'first_delta',\s*'terminal',\s*'persisted'\s*\)/,
    );
  });

  it("rejects a null stage before SQL enum membership evaluation", () => {
    const recordStage = telemetryFunctionSql("record_ai_chat_turn_stage");

    expect(recordStage).toMatch(
      /if p_stage is null then\s+raise exception 'ai_chat_turn_stage_invalid';\s+end if;/,
    );
    expectSqlOrder(recordStage, ["p_stage is null", "p_stage not in ("]);
  });

  it("keeps stage retries idempotent and returns only sanitized telemetry", () => {
    const recordStage = telemetryFunctionSql("record_ai_chat_turn_stage");

    for (const column of [
      "accepted_at",
      "context_ready_at",
      "session_ready_at",
      "agent_ready_at",
      "first_delta_at",
      "terminal_at",
      "persisted_at",
      "session_action",
    ]) {
      expect(recordStage).toContain(`coalesce(${column},`);
    }
    expect(recordStage).toContain(
      "p_session_action is not null and p_stage <> 'session_ready'",
    );
    expect(recordStage).toContain(
      "p_session_action not in ('resumed', 'rebuilt')",
    );
    expect(recordStage).toContain(
      "v_effective_accepted_at := coalesce(v_turn.accepted_at, v_turn.created_at)",
    );
    expect(recordStage).toContain(
      "not (p_stage = 'accepted' and v_turn.accepted_at is null)",
    );
    expectSqlOrder(recordStage, [
      "if v_existing is not null",
      "not (p_stage = 'accepted' and v_turn.accepted_at is null)",
      "return jsonb_build_object(",
      "update public.ai_chat_turns",
    ]);
    expect(recordStage).toContain(
      "set accepted_at = coalesce(accepted_at, created_at)",
    );
    expect(recordStage).toContain("jsonb_build_object(");
    for (const key of ["'turnid'", "'stage'", "'observedat'"]) {
      expect(recordStage).toContain(key);
    }
    for (const forbidden of [
      "prompt",
      "content",
      "provider_name",
      "context_snapshot",
    ]) {
      expect(recordStage).not.toContain(`'${forbidden}'`);
    }
  });

  it("keeps telemetry updates off the business updated_at trigger", () => {
    const telemetrySql = `${telemetryMigration}\n${telemetryBackfillMigration}`;

    expect(telemetrySql).not.toContain("to_jsonb(new)");
    expect(telemetrySql).not.toContain("to_jsonb(old)");
    expect(telemetrySql).not.toContain(
      "create or replace function public.preserve_ai_chat_turn_updated_at_for_telemetry",
    );
    expect(telemetryBackfillMigration).toContain(
      "drop function if exists public.preserve_ai_chat_turn_updated_at_for_telemetry()",
    );
    expect(telemetryBackfillMigration).toContain(
      "drop trigger if exists ai_chat_turns_touch_updated_at",
    );
    expect(telemetryBackfillMigration).toContain(
      "from pg_catalog.pg_attribute",
    );
    expect(telemetryBackfillMigration).toContain(
      "format('%i', attribute.attname)",
    );
    expect(telemetryBackfillMigration).toContain(
      "and not attribute.attisdropped",
    );
    expect(telemetryBackfillMigration).toMatch(
      /create trigger ai_chat_turns_touch_updated_at before update of %s on public\.ai_chat_turns/,
    );
    const telemetryColumns = [
      "accepted_at",
      "context_ready_at",
      "session_ready_at",
      "agent_ready_at",
      "first_delta_at",
      "terminal_at",
      "persisted_at",
      "session_action",
    ];
    for (const sql of [telemetryMigration, telemetryBackfillMigration]) {
      const exclusion = sql.match(
        /attribute\.attname not in \(([\s\S]*?)\n\s*\);/,
      );
      expect(exclusion).not.toBeNull();
      const excludedColumns = [
        ...(exclusion?.[1].matchAll(/'([^']+)'/g) ?? []),
      ].map((match) => match[1]);
      expect(excludedColumns).toEqual(telemetryColumns);
    }
    expect(telemetryBackfillMigration).not.toMatch(
      /attribute\.attname not in \([\s\S]*?'updated_at'[\s\S]*?\);/,
    );
    expect(telemetryBackfillMigration).toContain("v_business_columns is null");
    expect(telemetryBackfillMigration).not.toContain(
      "create trigger zz_ai_chat_turns_preserve_updated_at_for_telemetry",
    );
  });

  it("keeps authoritative finish persistence independent from telemetry machinery", () => {
    const finishV2 = functionSql("finish_ai_chat_turn_v2");

    expect(finishV2).not.toContain("record_ai_chat_turn_stage");
    expect(finishV2).not.toContain(
      "preserve_ai_chat_turn_updated_at_for_telemetry",
    );
    for (const column of [
      "accepted_at",
      "context_ready_at",
      "session_ready_at",
      "agent_ready_at",
      "first_delta_at",
      "terminal_at",
      "persisted_at",
      "session_action",
    ]) {
      expect(finishV2).not.toContain(column);
    }
  });

  it("grants turn-stage recording only to service_role", () => {
    const signature =
      "public.record_ai_chat_turn_stage(uuid, uuid, uuid, uuid, text, timestamptz, text)";
    for (const role of ["public", "anon", "authenticated"]) {
      expect(telemetryMigration).toContain(
        `revoke execute on function ${signature} from ${role}`,
      );
    }
    expect(telemetryMigration).toContain(
      `grant execute on function ${signature} to service_role`,
    );
  });

  it("ships as one additive migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).not.toContain("drop table public.ai_");
    expect(migration).not.toContain(
      "create or replace function public.finish_ai_chat_turn(",
    );
    expect(migration).toContain(
      "create or replace function public.finish_ai_chat_turn_v2(",
    );
  });

  it("stores only a hashed, fully bound run capability", () => {
    const table = tableSql("ai_hermes_run_capabilities");

    expect(table).toContain("token_sha256 text not null");
    expect(table).not.toMatch(
      /\n\s*(raw_capability|capability_token|raw_token|token)\s+/,
    );
    for (const column of [
      "organization_id uuid not null",
      "owner_user_id uuid not null",
      "conversation_id uuid not null",
      "turn_id uuid not null",
      "invocation_id uuid not null",
      "root_invocation_id uuid not null",
      "parent_capability_id uuid",
      "parent_invocation_id uuid",
      "actor_fingerprint text not null",
      "allowed_tools text[] not null",
      "allowed_tools_hash text not null",
      "scopes text[] not null",
      "scope_hash text not null",
      "skill_grants_hash text not null",
      "depth integer not null",
      "ai_state_writes_allowed boolean not null",
      "memory_snapshot_at timestamptz not null",
      "memory_snapshot_generation bigint not null",
      "expires_at timestamptz not null",
      "revoked_at timestamptz",
      "last_used_at timestamptz",
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toContain("unique (token_sha256)");
    expect(table).toContain("depth >= 0 and depth <= 2");
    expect(table).not.toContain("depth <= 3");
  });

  it("binds root and child capabilities to one immutable turn memory snapshot", () => {
    const table = tableSql("ai_hermes_run_capabilities");
    const issue = functionSql("issue_ai_hermes_run_capability");

    expect(migration).toContain(
      "add column if not exists memory_snapshot_at timestamptz",
    );
    expect(migration).toContain("alter column memory_snapshot_at set not null");
    expect(table).toContain("memory_snapshot_at timestamptz not null");
    expect(table).toContain("memory_snapshot_generation bigint not null");
    expect(issue).toContain(
      "v_memory_snapshot_at := v_turn.memory_snapshot_at",
    );
    expect(issue).toContain(
      "v_parent.memory_snapshot_at is distinct from v_turn.memory_snapshot_at",
    );
    expect(issue).toContain(
      "v_memory_snapshot_at := v_parent.memory_snapshot_at",
    );
    expect(issue).toContain(
      "v_memory_snapshot_generation := v_turn.memory_snapshot_generation",
    );
    expect(issue).toContain(
      "v_memory_snapshot_generation := v_parent.memory_snapshot_generation",
    );
    expect(issue).toContain("p_depth > 0 and v_allowed_tools && array[");
    for (const childForbiddenTool of [
      "xingyao_memory_remember",
      "xingyao_memory_forget",
      "xingyao_skill_draft",
    ]) {
      expect(issue).toContain(`'${childForbiddenTool}'`);
    }
    expect(issue).toContain("capability_delegation_invalid");
    expect(issue).toMatch(
      /insert into public\.ai_hermes_run_capabilities[\s\S]*?memory_snapshot_at[\s\S]*?v_memory_snapshot_at/,
    );
    expect(issue).toMatch(
      /insert into public\.ai_hermes_run_capabilities[\s\S]*?memory_snapshot_generation[\s\S]*?v_memory_snapshot_generation/,
    );
  });

  it("canonically binds capability tool, scope, and approved skill lists", () => {
    const textArrayHash = functionSql("ai_hermes_canonical_text_array_sha256");
    const uuidArrayHash = functionSql("ai_hermes_canonical_uuid_array_sha256");
    const issue = functionSql("issue_ai_hermes_run_capability");
    const claim = functionSql("claim_ai_hermes_broker_call");

    for (const helper of [textArrayHash, uuidArrayHash]) {
      expect(helper).toContain("security definer");
      expect(helper).toContain("set search_path = pg_catalog, public");
      expect(helper).toContain("extensions.digest");
      expect(helper).toContain("'sha256'");
      expect(helper).toContain("'[]'::jsonb");
    }
    for (const helperName of [
      "ai_hermes_canonical_text_array_sha256",
      "ai_hermes_canonical_uuid_array_sha256",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${helperName}(`,
      );
      expect(migration).toContain(
        `grant execute on function public.${helperName}(`,
      );
    }
    expect(textArrayHash).toContain(
      'jsonb_agg(value order by value collate "c")',
    );
    expect(uuidArrayHash).toContain(
      'jsonb_agg(value::text order by value::text collate "c")',
    );

    expect(issue).toContain("p_allowed_tools_hash text");
    expect(issue).toContain(
      "p_allowed_tools is null or p_scopes is null or p_skill_draft_ids is null",
    );
    expect(issue).toContain("capability_binding_list_invalid");
    expect(issue).toContain('count(distinct value collate "c") <> count(*)');
    expect(issue).toContain("count(distinct value) <> count(*)");
    expect(issue).toContain('array_agg(value order by value collate "c")');
    expect(issue).toContain(
      'array_agg(value order by value::text collate "c")',
    );
    expect(issue).toContain(
      "v_allowed_tools_hash := public.ai_hermes_canonical_text_array_sha256(v_allowed_tools)",
    );
    expect(issue).toContain(
      "v_scope_hash := public.ai_hermes_canonical_text_array_sha256(v_scopes)",
    );
    expect(issue).toContain(
      "v_skill_grants_hash := public.ai_hermes_canonical_uuid_array_sha256(v_skill_draft_ids)",
    );
    expect(issue).toContain(
      "lower(p_allowed_tools_hash) is distinct from v_allowed_tools_hash",
    );
    expect(issue).toContain(
      "lower(p_scope_hash) is distinct from v_scope_hash",
    );
    expect(issue).toContain(
      "lower(p_skill_grants_hash) is distinct from v_skill_grants_hash",
    );
    expect(issue).toContain("capability_binding_hash_mismatch");

    expect(claim).toContain(
      "v_capability.allowed_tools_hash is distinct from public.ai_hermes_canonical_text_array_sha256(v_capability.allowed_tools)",
    );
    expect(claim).toContain(
      "v_capability.scope_hash is distinct from public.ai_hermes_canonical_text_array_sha256(v_capability.scopes)",
    );
    expect(claim).toContain(
      "v_capability.skill_grants_hash is distinct from public.ai_hermes_canonical_uuid_array_sha256(v_capability.skill_draft_ids)",
    );
    expect(claim).toContain("capability_binding_list_invalid");
    expect(claim).toContain("skill_draft.status <> 'approved'");
    expect(claim).toContain("capability_binding_invalid");
  });

  it("makes broker claims atomic and replay safe", () => {
    const table = tableSql("ai_hermes_broker_calls");
    const claim = functionSql("claim_ai_hermes_broker_call");

    expect(table).toContain("capability_id uuid not null");
    expect(table).toContain("tool_call_id text not null");
    expect(table).toContain("request_sha256 text not null");
    expect(table).toContain("status text not null");
    expect(table).toContain("sanitized_response_envelope jsonb");
    expect(table).toContain("tool_message_id uuid");
    expect(table).toContain("unique (tool_message_id)");
    expect(table).toContain("claim_owner_id uuid not null");
    expect(table).toContain("claim_lease_expires_at timestamptz not null");
    expect(table).toContain("claim_attempt integer not null");
    expect(table).toContain("fencing_token bigint not null");
    expect(table).toContain("unique (capability_id, tool_call_id)");
    expect(table).not.toMatch(/\n\s*(raw_response|response)\s+jsonb/);

    expect(claim).toContain("for update");
    expect(claim).toContain("p_organization_id uuid");
    expect(claim).toContain("p_owner_user_id uuid");
    expect(claim).toMatch(
      /discovered_capability\.token_sha256 = lower\(p_token_sha256\)\s+and discovered_capability\.organization_id = p_organization_id\s+and discovered_capability\.owner_user_id = p_owner_user_id/,
    );
    expect(claim).toMatch(/token_sha256\s*=\s*lower\(p_token_sha256\)/);
    expect(claim).toMatch(/revoked_at\s+is\s+null/);
    expect(claim).toMatch(/expires_at\s*>\s*now\(\)/);
    expect(claim).toMatch(
      /turn\.ai_invocation_id\s*=\s*v_capability\.root_invocation_id/,
    );
    expect(claim).toMatch(/turn\.lease_expires_at\s*>\s*now\(\)/);
    expect(claim).toContain(
      "turn.status in ('accepted', 'grounding', 'generating', 'validating')",
    );
    expect(claim).toContain(
      "lower(p_actor_fingerprint) is distinct from v_capability.actor_fingerprint",
    );
    expect(claim).toContain(
      "not (p_tool_name = any(v_capability.allowed_tools))",
    );
    expect(claim).toContain(
      "v_existing.request_sha256 is distinct from lower(p_request_sha256)",
    );
    expect(claim).toContain("broker_call_request_conflict");
    expect(claim).toContain("'reused', true");
    expect(claim).toContain("sanitized_response_envelope");
    expect(claim).toContain("v_existing.tool_message_id is null");
    expect(claim).toMatch(
      /from public\.ai_chat_messages tool_message[\s\S]*?tool_message\.id = v_existing\.tool_message_id[\s\S]*?tool_message\.role = 'tool'/,
    );
  });

  it("claims capability-listed memory writes before the write RPC decides authority", () => {
    const claim = functionSql("claim_ai_hermes_broker_call");

    expect(claim).toContain(
      "if p_tool_name = 'xingyao_skill_draft' and not v_capability.ai_state_writes_allowed",
    );
    expect(claim).not.toMatch(
      /if p_tool_name = any\(array\[[\s\S]*?'xingyao_memory_remember'[\s\S]*?capability_state_write_not_allowed/,
    );
    expect(claim).not.toMatch(
      /if p_tool_name = any\(array\[[\s\S]*?'xingyao_memory_forget'[\s\S]*?capability_state_write_not_allowed/,
    );
  });

  it("uses one documented global lock order for Broker and tool messages", () => {
    const claim = functionSql("claim_ai_hermes_broker_call");
    const complete = functionSql("complete_ai_hermes_broker_call");
    const append = functionSql("append_ai_hermes_tool_message");
    const lockOrder =
      "hermes lock order: conversation -> turn -> invocation -> capability -> broker_call";

    for (const sql of [claim, complete, append]) {
      expect(sql).toContain(lockOrder);
    }
    expectSqlOrder(claim, [
      "from public.ai_conversations locked_conversation",
      "from public.ai_chat_turns locked_turn",
      "from public.ai_invocations locked_invocation",
      "from public.ai_hermes_run_capabilities locked_capability",
      "from public.ai_hermes_broker_calls locked_broker_call",
    ]);
    expectSqlOrder(complete, [
      "from public.ai_conversations locked_conversation",
      "from public.ai_chat_turns locked_turn",
      "from public.ai_invocations locked_invocation",
      "from public.ai_hermes_run_capabilities locked_capability",
      "from public.ai_hermes_broker_calls locked_broker_call",
    ]);
    expectSqlOrder(append, [
      "from public.ai_conversations locked_conversation",
      "from public.ai_chat_turns locked_turn",
    ]);
  });

  it("revokes terminal invocation capabilities and rejects stale invocation use", () => {
    const revokeTerminal = functionSql(
      "revoke_ai_hermes_capabilities_for_terminal_invocation",
    );
    const issue = functionSql("issue_ai_hermes_run_capability");
    const claim = functionSql("claim_ai_hermes_broker_call");

    expect(revokeTerminal).toContain("returns trigger");
    expect(revokeTerminal).toContain("old.status in ('started', 'queued')");
    expect(revokeTerminal).toContain(
      "new.status in ('succeeded', 'failed', 'degraded')",
    );
    expect(revokeTerminal).toContain(
      "update public.ai_hermes_run_capabilities",
    );
    for (const fence of [
      "invocation_id = new.id",
      "organization_id = new.organization_id",
      "owner_user_id = new.actor_user_id",
      "revoked_at is null",
    ]) {
      expect(revokeTerminal).toContain(fence);
    }
    expect(migration).toMatch(
      /create trigger ai_invocations_revoke_terminal_hermes_capabilities\s+after update of status on public\.ai_invocations\s+for each row execute function public\.revoke_ai_hermes_capabilities_for_terminal_invocation\(\)/,
    );
    expect(migration).toContain(
      "revoke all on function public.revoke_ai_hermes_capabilities_for_terminal_invocation()",
    );

    expect(issue).toMatch(
      /from public\.ai_invocations invocation[\s\S]*?invocation\.id = p_invocation_id[\s\S]*?invocation\.organization_id = p_organization_id[\s\S]*?invocation\.actor_user_id = p_owner_user_id[\s\S]*?invocation\.status in \('started', 'queued'\)[\s\S]*?for update/,
    );
    expect(issue).toMatch(
      /from public\.ai_invocations parent_invocation[\s\S]*?parent_invocation\.id = p_parent_invocation_id[\s\S]*?parent_invocation\.organization_id = p_organization_id[\s\S]*?parent_invocation\.actor_user_id = p_owner_user_id[\s\S]*?parent_invocation\.status in \('started', 'queued'\)[\s\S]*?for update/,
    );
    expect(claim).toMatch(
      /from public\.ai_invocations locked_invocation[\s\S]*?locked_invocation\.id = v_capability\.invocation_id[\s\S]*?locked_invocation\.organization_id = v_capability\.organization_id[\s\S]*?locked_invocation\.actor_user_id = v_capability\.owner_user_id[\s\S]*?locked_invocation\.status in \('started', 'queued'\)[\s\S]*?for update/,
    );
  });

  it("stores auditable owner memories with four approved types", () => {
    const table = tableSql("ai_hermes_memories");

    for (const column of [
      "organization_id uuid not null",
      "owner_user_id uuid not null",
      "memory_type text not null",
      "content text not null",
      "content_hash text not null",
      "revision integer not null",
      "active boolean not null",
      "source_conversation_id uuid not null",
      "source_message_id uuid not null",
      "source_invocation_id uuid not null",
      "deactivated_at timestamptz",
      "effective_generation bigint not null",
      "deactivated_generation bigint",
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toMatch(
      /memory_type in \(\s*'preference',\s*'workflow',\s*'communication',\s*'user_instruction'\s*\)/,
    );
    expect(table).toContain("revision > 0");
  });

  it("captures commit-safe owner memory generations for turns and capabilities", () => {
    const clock = tableSql("ai_hermes_memory_owner_clocks");
    const capability = tableSql("ai_hermes_run_capabilities");
    const capture = functionSql("capture_ai_hermes_memory_snapshot_generation");

    expect(clock).toContain("organization_id uuid not null");
    expect(clock).toContain("owner_user_id uuid not null");
    expect(clock).toContain("generation bigint not null default 0");
    expect(migration).toContain(
      "add column if not exists memory_snapshot_generation bigint",
    );
    expect(capability).toContain("memory_snapshot_generation bigint not null");
    expect(capture).toContain("for update");
    expect(capture).toContain("new.memory_snapshot_generation :=");
    expect(migration).toMatch(
      /create trigger ai_chat_turns_capture_hermes_memory_generation[\s\S]*?before insert on public\.ai_chat_turns/,
    );
  });

  it("loads the latest actor-owned memory revision active at a generation snapshot", () => {
    const snapshot = functionSql("load_ai_hermes_memory_snapshot");

    expect(snapshot).toContain("p_organization_id uuid");
    expect(snapshot).toContain("p_owner_user_id uuid");
    expect(snapshot).toContain("p_snapshot_generation bigint");
    expect(snapshot).toContain("security definer");
    expect(snapshot).toContain("set search_path = pg_catalog, public");
    expect(snapshot).toContain("memory.organization_id = p_organization_id");
    expect(snapshot).toContain("memory.owner_user_id = p_owner_user_id");
    expect(snapshot).toContain(
      "memory.effective_generation <= p_snapshot_generation",
    );
    expect(snapshot).toContain("memory.deactivated_generation is null");
    expect(snapshot).toContain(
      "memory.deactivated_generation > p_snapshot_generation",
    );
    expect(snapshot).toContain("distinct on (memory.memory_key)");
    expect(snapshot).toContain("memory.memory_key, memory.revision desc");
    expect(snapshot).toContain("memory.created_at as updated_at");
    expect(snapshot).toContain(
      "order by snapshot.created_at desc, snapshot.memory_key",
    );
    expect(snapshot).not.toContain("memory.updated_at");
    expect(snapshot).not.toContain("snapshot.updated_at desc");
    expect(snapshot).not.toContain("p_snapshot_at");
    expect(migration).toContain(
      "revoke all on function public.load_ai_hermes_memory_snapshot(",
    );
    expect(migration).toContain(
      "grant execute on function public.load_ai_hermes_memory_snapshot(",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.load_ai_hermes_memory_snapshot[^;]*to (anon|authenticated);/,
    );
  });

  it("atomically mutates memory, persists one response, appends one audit, and completes the fenced claim", () => {
    const atomic = functionSql("complete_ai_hermes_memory_broker_call");

    expect(atomic).toContain("p_broker_call_id uuid");
    expect(atomic).toContain("p_fencing_token bigint");
    expect(atomic).toContain("for update");
    expect(atomic).toContain("claim_lease_expires_at <= now()");
    expect(atomic).toContain("write_ai_hermes_memory_revision(");
    expect(atomic).toContain("forget_ai_hermes_memory(");
    expect(atomic).toContain("state_conflict");
    expect(atomic).toContain("sanitized_response_envelope");
    expect(atomic).toContain("insert into public.ai_chat_messages");
    expect(atomic).toContain("'tool'");
    expect(atomic).toContain("update public.ai_hermes_broker_calls");
    expectSqlOrder(atomic, [
      "from public.ai_hermes_broker_calls broker_call",
      "write_ai_hermes_memory_revision(",
      "insert into public.ai_chat_messages",
      "update public.ai_hermes_broker_calls",
    ]);
    expect(atomic).toMatch(
      /if v_broker_call\.status in \('completed', 'failed', 'denied'\)[\s\S]*?return jsonb_build_object/,
    );
    expect(atomic).toMatch(
      /if v_broker_call\.status <> 'claimed'[\s\S]*?claim_lease_expires_at <= now\(\)[\s\S]*?raise exception 'broker_claim_fence_invalid';[\s\S]*?end if;\s+if \(p_operation = 'remember'/,
    );
    expect(atomic).not.toContain("or v_capability.revoked_at is not null");
    expect(atomic).not.toContain("or v_capability.expires_at <= now()");
  });

  it("validates memory provenance against the exact owner user message", () => {
    const writeMemory = functionSql("write_ai_hermes_memory_revision");
    const forgetMemory = functionSql("forget_ai_hermes_memory");

    for (const memoryFunction of [writeMemory, forgetMemory]) {
      expect(memoryFunction).toContain(
        "from public.ai_hermes_run_capabilities memory_capability",
      );
      expect(memoryFunction).toContain(
        "memory_capability.token_sha256 = lower(p_capability_token_sha256)",
      );
      expect(memoryFunction).toContain("v_capability.depth <> 0");
      expect(memoryFunction).toContain("v_capability.ai_state_writes_allowed");
      expect(memoryFunction).toContain(
        "v_capability.root_invocation_id <> p_parent_invocation_id",
      );
      expect(memoryFunction).toContain(
        "from public.ai_chat_messages source_message",
      );
      expect(memoryFunction).toContain("source_message.role = 'user'");
      expect(memoryFunction).toContain(
        "source_message.organization_id = p_organization_id",
      );
      expect(memoryFunction).toContain(
        "source_message.owner_user_id = p_owner_user_id",
      );
      expect(memoryFunction).toContain(
        "source_message.conversation_id = p_source_conversation_id",
      );
      expect(memoryFunction).toContain("from public.ai_chat_turns source_turn");
      expect(memoryFunction).toContain(
        "source_turn.user_message_id = p_source_message_id",
      );
      expect(memoryFunction).toContain(
        "source_turn.ai_invocation_id = v_capability.root_invocation_id",
      );
      expect(memoryFunction).toContain("memory_source_invalid");
    }
    expect(writeMemory).toContain("expected_revision");
    expect(writeMemory).toContain("deactivated_at");
  });

  it("locks and revalidates memory source authority in the global order", () => {
    const writeMemory = functionSql("write_ai_hermes_memory_revision");
    const forgetMemory = functionSql("forget_ai_hermes_memory");
    const lockOrder =
      "hermes memory lock order: conversation -> turn -> invocation -> capability -> source_message -> memory";

    for (const memoryFunction of [writeMemory, forgetMemory]) {
      expect(memoryFunction).toContain(lockOrder);
      expectSqlOrder(memoryFunction, [
        "from public.ai_conversations locked_conversation",
        "from public.ai_chat_turns source_turn",
        "from public.ai_invocations source_invocation",
        "from public.ai_hermes_run_capabilities memory_capability",
        "from public.ai_chat_messages source_message",
        "pg_advisory_xact_lock",
      ]);
      for (const alias of [
        "locked_conversation",
        "source_turn",
        "source_invocation",
        "memory_capability",
        "source_message",
      ]) {
        expect(memoryFunction).toMatch(
          new RegExp(`from public\\.[a-z_]+ ${alias}[\\s\\S]*?for update`),
        );
      }
      expect(memoryFunction).toContain(
        "source_turn.user_message_id = p_source_message_id",
      );
      expect(memoryFunction).toContain(
        "source_turn.memory_snapshot_at = v_capability.memory_snapshot_at",
      );
      expect(memoryFunction).toContain(
        "source_turn.memory_snapshot_generation =",
      );
    }
  });

  it("prevents a committed memory source from being invalidated later", () => {
    const protectSource = functionSql("protect_ai_hermes_memory_source");

    expect(protectSource).toContain("returns trigger");
    expect(protectSource).toContain("from public.ai_hermes_memories memory");
    expect(protectSource).toContain("memory.source_message_id = old.id");
    for (const field of [
      "id",
      "organization_id",
      "owner_user_id",
      "conversation_id",
      "role",
      "status",
      "content",
    ]) {
      expect(protectSource).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    }
    expect(protectSource).toContain("memory_source_immutable");
    expect(migration).toMatch(
      /create trigger ai_chat_messages_protect_hermes_memory_source\s+before update of[\s\S]*?on public\.ai_chat_messages\s+for each row execute function public\.protect_ai_hermes_memory_source\(\)/,
    );
    expect(migration).toContain(
      "revoke all on function public.protect_ai_hermes_memory_source()",
    );
  });

  it("soft-deactivates actor-owned memory as a new retry-safe revision", () => {
    const forgetMemory = functionSql("forget_ai_hermes_memory");
    const locks = forgetMemory.match(/pg_advisory_xact_lock/g) ?? [];

    expect(locks).toHaveLength(2);
    expect(forgetMemory).toContain("ai_hermes_memory_forget:");
    expect(forgetMemory).toContain("ai_hermes_memory_key:");
    expect(forgetMemory).toContain(
      "memory.organization_id = p_organization_id",
    );
    expect(forgetMemory).toContain("memory.owner_user_id = p_owner_user_id");
    expect(forgetMemory).toContain("memory.memory_key = p_memory_key");
    expect(forgetMemory).toContain(
      "v_existing.revision <> p_expected_revision",
    );
    expect(forgetMemory).toContain("not v_existing.active");
    expect(forgetMemory).toContain("set active = false");
    expect(forgetMemory).toMatch(
      /insert into public\.ai_hermes_memories \([\s\S]*?false,[\s\S]*?p_source_conversation_id,[\s\S]*?p_source_message_id,[\s\S]*?p_source_invocation_id/,
    );
    expect(forgetMemory).toContain("'reused', true");
    expect(forgetMemory).toContain("'reused', false");
  });

  it("keeps skill drafts reviewable and grants approved bundles only", () => {
    const table = tableSql("ai_hermes_skill_drafts");
    const issue = functionSql("issue_ai_hermes_run_capability");
    const review = functionSql("review_ai_hermes_skill_draft");

    for (const column of [
      "organization_id uuid not null",
      "owner_user_id uuid not null",
      "skill_id text not null",
      "version integer not null",
      "manifest jsonb not null",
      "bundle text not null",
      "bundle_sha256 text not null",
      "status text not null",
      "reviewed_by uuid",
      "reviewed_at timestamptz",
      "review_note text",
      "signature text",
      "signing_key_id text",
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toMatch(
      /status in \(\s*'draft',\s*'pending_review',\s*'approved',\s*'rejected',\s*'superseded'\s*\)/,
    );
    expect(table).toContain(
      "status <> 'approved' or (signature is not null and signing_key_id is not null)",
    );
    expect(issue).toContain("public.ai_hermes_skill_drafts skill_draft");
    expect(issue).toContain("skill_draft.status <> 'approved'");
    expect(issue).toContain("skill_grant_not_approved");
    expect(review).toContain("invalid_skill_review_transition");
  });

  it("derives child capabilities from a locked valid parent capability", () => {
    const table = tableSql("ai_hermes_run_capabilities");
    const issue = functionSql("issue_ai_hermes_run_capability");

    expect(table).toContain("parent_capability_id uuid");
    expect(table).toContain("root_invocation_id uuid not null");
    expect(table).toMatch(
      /foreign key \(\s*parent_capability_id,\s*organization_id,\s*owner_user_id,\s*conversation_id,\s*turn_id,\s*root_invocation_id,\s*parent_invocation_id\s*\) references public\.ai_hermes_run_capabilities\(\s*id,\s*organization_id,\s*owner_user_id,\s*conversation_id,\s*turn_id,\s*root_invocation_id,\s*invocation_id\s*\)/,
    );
    expect(table).toMatch(
      /\(depth = 0 and root_invocation_id = invocation_id and parent_capability_id is null and parent_invocation_id is null\)[\s\S]*?\(depth > 0 and parent_capability_id is not null and parent_invocation_id is not null\)/,
    );
    expect(table).toContain(
      "turn_id uuid not null references public.ai_chat_turns(id) on delete cascade",
    );

    expect(issue).toContain("p_parent_token_sha256 text");
    expect(issue).toMatch(
      /from public\.ai_hermes_run_capabilities parent_capability[\s\S]*?parent_capability\.token_sha256 = lower\(p_parent_token_sha256\)[\s\S]*?parent_capability\.revoked_at is null[\s\S]*?parent_capability\.expires_at > now\(\)[\s\S]*?for update/,
    );
    for (const binding of [
      "v_parent.organization_id is distinct from p_organization_id",
      "v_parent.owner_user_id is distinct from p_owner_user_id",
      "v_parent.conversation_id is distinct from p_conversation_id",
      "v_parent.turn_id is distinct from p_turn_id",
      "v_parent.invocation_id is distinct from p_parent_invocation_id",
      "p_depth <> v_parent.depth + 1",
      "lower(p_actor_fingerprint) is distinct from v_parent.actor_fingerprint",
      "not (v_allowed_tools <@ v_parent.allowed_tools)",
      "not (v_scopes <@ v_parent.scopes)",
      "not (v_skill_draft_ids <@ v_parent.skill_draft_ids)",
      "p_expires_at > v_parent.expires_at",
      "p_ai_state_writes_allowed",
      "parent_skill_draft.status <> 'approved'",
    ]) {
      expect(issue).toContain(binding);
    }
    expect(issue).toContain("capability_parent_invalid");
    expect(issue).toMatch(
      /p_depth = 0[\s\S]*?p_parent_token_sha256 is not null[\s\S]*?p_parent_invocation_id is not null/,
    );
    expect(issue).toContain("parent_capability_id");
    expect(issue).toContain("v_parent.id");
    expect(issue).toContain("v_root_invocation_id := p_invocation_id");
    expect(issue).toContain(
      "v_root_invocation_id := v_parent.root_invocation_id",
    );
    expect(issue).toContain(
      "v_turn.ai_invocation_id is distinct from v_root_invocation_id",
    );
    expect(functionSql("claim_ai_hermes_broker_call")).toContain(
      "turn.ai_invocation_id = v_capability.root_invocation_id",
    );
  });

  it("serializes and enforces mode-aware run-wide subagent limits before capability insert", () => {
    const issue = functionSql("issue_ai_hermes_run_capability");
    const turnLock = issue.indexOf("from public.ai_chat_turns turn");
    const turnLocked = issue.indexOf("for update", turnLock);
    const parentLock = issue.indexOf(
      "from public.ai_hermes_run_capabilities parent_capability",
    );
    const parentLocked = issue.indexOf("for update", parentLock);
    const parallelCount = issue.indexOf("into v_active_subagents");
    const capabilityInsert = issue.indexOf(
      "insert into public.ai_hermes_run_capabilities",
    );

    expect(turnLock).toBeGreaterThanOrEqual(0);
    expect(turnLocked).toBeGreaterThan(turnLock);
    expect(parentLock).toBeGreaterThan(turnLocked);
    expect(parentLocked).toBeGreaterThan(parentLock);
    expect(parallelCount).toBeGreaterThan(parentLocked);
    expect(capabilityInsert).toBeGreaterThan(parallelCount);
    expect(issue).toContain("join public.ai_invocations subagent_invocation");
    for (const fence of [
      "subagent_capability.organization_id = p_organization_id",
      "subagent_capability.owner_user_id = p_owner_user_id",
      "subagent_capability.conversation_id = p_conversation_id",
      "subagent_capability.turn_id = p_turn_id",
      "subagent_capability.root_invocation_id = v_root_invocation_id",
      "subagent_capability.depth > 0",
      "subagent_capability.revoked_at is null",
      "subagent_capability.expires_at > now()",
      "subagent_invocation.id = subagent_capability.invocation_id",
      "subagent_invocation.organization_id = p_organization_id",
      "subagent_invocation.actor_user_id = p_owner_user_id",
      "subagent_invocation.status in ('started', 'queued')",
    ]) {
      expect(issue).toContain(fence);
    }
    expect(issue).not.toContain(
      "subagent_capability.parent_capability_id = v_parent.id",
    );
    expect(issue).toMatch(
      /v_turn\.mode = 'fast'[\s\S]*?v_active_subagents >= 1/,
    );
    expect(issue).toMatch(
      /v_turn\.mode = 'deep'[\s\S]*?v_active_subagents >= 3/,
    );
    expect(issue).toContain("capability_parallel_limit");
  });

  it("enforces Fast depth 1 and Deep depth 2 in the table and issuer", () => {
    const identity = functionSql("validate_ai_hermes_run_capability_identity");
    const issue = functionSql("issue_ai_hermes_run_capability");
    const lineage = functionSql(
      "lock_and_validate_ai_hermes_capability_lineage",
    );
    const turnLock = issue.indexOf("from public.ai_chat_turns turn");
    const turnLocked = issue.indexOf("for update", turnLock);
    const depthLimit = issue.indexOf("capability_depth_limit", turnLocked);
    const parentLock = issue.indexOf(
      "from public.ai_hermes_run_capabilities parent_capability",
    );

    expect(identity).toMatch(
      /\(turn\.mode = 'fast' and new\.depth > 1\)[\s\S]*?\(turn\.mode = 'deep' and new\.depth > 2\)/,
    );
    expect(identity).toContain("capability_depth_limit");
    expect(turnLocked).toBeGreaterThan(turnLock);
    expect(depthLimit).toBeGreaterThan(turnLocked);
    expect(depthLimit).toBeLessThan(parentLock);
    expect(issue).toMatch(
      /\(v_turn\.mode = 'fast' and p_depth > 1\)[\s\S]*?\(v_turn\.mode = 'deep' and p_depth > 2\)/,
    );
    expect(issue).not.toContain("p_depth > 3");
    expect(lineage).toContain("p_expected_depth > 2");
    expect(lineage).not.toContain("p_expected_depth > 3");
  });

  it("locks and validates every delegated capability ancestor", () => {
    const lineage = functionSql(
      "lock_and_validate_ai_hermes_capability_lineage",
    );
    const issue = functionSql("issue_ai_hermes_run_capability");
    const claim = functionSql("claim_ai_hermes_broker_call");
    const recursivePasses =
      lineage.match(/with recursive capability_lineage as/g) ?? [];

    expect(lineage).toContain("security definer");
    expect(lineage).toContain("set search_path = pg_catalog, public");
    expect(recursivePasses).toHaveLength(2);
    expect(lineage).toContain("parent_capability.id = any(lineage.path)");
    expect(lineage).toContain(
      "parent_capability.invocation_id = lineage.parent_invocation_id",
    );
    expect(lineage).toContain("parent_capability.depth = lineage.depth - 1");
    expect(lineage).toContain("lineage.hop < 3");
    expect(lineage).toContain(
      "lineage.depth <> p_expected_depth - lineage.hop",
    );
    expect(lineage).toContain("v_lineage_count <> p_expected_depth + 1");
    for (const ancestorFailure of [
      "lineage.revoked_at is not null",
      "lineage.expires_at <= now()",
      "lineage.organization_id is distinct from p_organization_id",
      "lineage.owner_user_id is distinct from p_owner_user_id",
      "lineage.conversation_id is distinct from p_conversation_id",
      "lineage.turn_id is distinct from p_turn_id",
      "lineage.actor_fingerprint is distinct from p_actor_fingerprint",
      "lineage.root_invocation_id is distinct from p_root_invocation_id",
      "lineage.cycle",
      "not lineage.link_valid",
    ]) {
      expect(lineage).toContain(ancestorFailure);
    }
    expect(lineage.indexOf("for update")).toBeLessThan(
      lineage.lastIndexOf("with recursive capability_lineage as"),
    );
    expect(lineage).toContain("capability_lineage_invalid");
    expect(issue).toContain(
      "public.lock_and_validate_ai_hermes_capability_lineage(",
    );
    expect(issue).toMatch(
      /public\.lock_and_validate_ai_hermes_capability_lineage\([\s\S]*?p_depth - 1[\s\S]*?\);/,
    );
    expect(claim).toContain(
      "public.lock_and_validate_ai_hermes_capability_lineage(",
    );
    expect(claim).toMatch(
      /public\.lock_and_validate_ai_hermes_capability_lineage\([\s\S]*?v_capability\.depth[\s\S]*?\);/,
    );
    expect(migration).toContain(
      "revoke all on function public.lock_and_validate_ai_hermes_capability_lineage(",
    );
  });

  it("pins finish v2 and ledger invocation IDs to the exact tenant actor", () => {
    const finishV2 = functionSql("finish_ai_chat_turn_v2");
    const invocationCheck = finishV2.indexOf(
      "from public.ai_invocations invocation",
    );
    const firstLedgerWrite = finishV2.indexOf("update public.ai_chat_messages");

    expect(invocationCheck).toBeGreaterThan(-1);
    expect(invocationCheck).toBeLessThan(firstLedgerWrite);
    expect(finishV2).toMatch(
      /invocation\.id = p_ai_invocation_id\s+and invocation\.organization_id = p_organization_id\s+and invocation\.actor_user_id = p_owner_user_id/,
    );
    expect(finishV2).toContain("if not found then\n    return false;");
  });

  it("uses owner leases and fencing tokens for crash-safe broker claims", () => {
    const table = tableSql("ai_hermes_broker_calls");
    const claim = functionSql("claim_ai_hermes_broker_call");
    const complete = functionSql("complete_ai_hermes_broker_call");

    for (const column of [
      "claim_owner_id uuid not null",
      "claim_lease_expires_at timestamptz not null",
      "claim_attempt integer not null default 1",
      "fencing_token bigint not null default 1",
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toContain("claim_attempt > 0");
    expect(table).toContain("fencing_token > 0");
    expect(claim).toContain("p_claim_owner_id uuid");
    expect(claim).toContain("p_claim_owner_id is null");
    expect(claim).toContain(
      "on conflict (capability_id, tool_call_id) do nothing",
    );
    expect(claim).toMatch(
      /v_existing\.status in \('completed', 'failed', 'denied'\)[\s\S]*?'execute', false[\s\S]*?'reused', true[\s\S]*?'fencing_token', v_existing\.fencing_token/,
    );
    expect(claim).toMatch(
      /v_existing\.claim_lease_expires_at > now\(\)[\s\S]*?v_existing\.claim_owner_id = p_claim_owner_id[\s\S]*?'execute', true[\s\S]*?'reused', true/,
    );
    expect(claim).toMatch(
      /v_existing\.claim_lease_expires_at > now\(\)[\s\S]*?'execute', false/,
    );
    expect(claim).toMatch(
      /set claim_owner_id = p_claim_owner_id,[\s\S]*?claim_attempt = claim_attempt \+ 1,[\s\S]*?fencing_token = fencing_token \+ 1/,
    );
    expect(claim).toContain("'execute', true");
    expect(claim).toContain("'fencing_token'");

    expect(complete).toContain("p_claim_owner_id uuid");
    expect(complete).toContain("p_organization_id uuid");
    expect(complete).toContain("p_owner_user_id uuid");
    expect(complete).toMatch(
      /locked_broker_call\.id = p_broker_call_id[\s\S]*?locked_broker_call\.capability_id = v_capability\.id[\s\S]*?locked_broker_call\.organization_id = p_organization_id[\s\S]*?locked_broker_call\.owner_user_id = p_owner_user_id/,
    );
    expect(complete).toContain("p_fencing_token bigint");
    expect(complete).toContain("p_tool_content text");
    expect(complete).toContain("p_tool_metadata jsonb");
    expect(complete).toMatch(
      /v_call\.claim_owner_id is distinct from p_claim_owner_id\s+or v_call\.fencing_token is distinct from p_fencing_token/,
    );
    expect(complete).toContain(
      "v_call.status = 'claimed' and v_call.claim_lease_expires_at <= now()",
    );
    expect(complete).toContain("broker_call_fence_invalid");
    expect(complete).toContain("'fencing_token', v_call.fencing_token");
    expect(complete).toMatch(
      /from public\.ai_conversations locked_conversation[\s\S]*?for update/,
    );
    expect(complete).toContain("coalesce(max(sequence_no), 0) + 1");
    expect(complete).toMatch(
      /insert into public\.ai_chat_messages[\s\S]*?'tool'[\s\S]*?'completed'/,
    );
    expect(complete).toContain("tool_message_id = v_message_id");
    expect(complete).toContain("v_call.tool_message_id is null");
    expect(complete).toContain("'message_id', v_message_id");
    expect(complete).toContain("'sequence_no', v_message_sequence");
  });

  it("serializes memory idempotency and compares the complete request", () => {
    const table = tableSql("ai_hermes_memories");
    const writeMemory = functionSql("write_ai_hermes_memory_revision");
    const locks = writeMemory.match(/pg_advisory_xact_lock/g) ?? [];

    expect(table).toContain("idempotency_key text not null");
    expect(table).toContain("requested_memory_key uuid");
    expect(table).toContain("requested_expected_revision integer not null");
    expect(table).toContain("requested_expected_revision >= 0");
    expect(table).toContain("revision = requested_expected_revision + 1");
    expect(table).toContain(
      "requested_memory_key is null or requested_memory_key = memory_key",
    );
    expect(table).toContain(
      "unique (organization_id, owner_user_id, idempotency_key)",
    );
    expect(writeMemory).toContain("p_idempotency_key text");
    expect(writeMemory).toContain("p_expected_revision is null");
    expect(locks).toHaveLength(2);
    expect(writeMemory).toContain("ai_hermes_memory_idempotency:");
    expect(writeMemory).toContain("ai_hermes_memory_key:");
    for (const comparison of [
      "v_idempotent.requested_memory_key is distinct from p_memory_key",
      "v_idempotent.requested_expected_revision is distinct from p_expected_revision",
      "v_idempotent.source_conversation_id <> p_source_conversation_id",
      "v_idempotent.source_message_id <> p_source_message_id",
      "v_idempotent.source_invocation_id <> p_source_invocation_id",
      "v_idempotent.memory_type <> p_memory_type",
      "v_idempotent.content <> p_content",
      "v_idempotent.active <> p_active",
    ]) {
      expect(writeMemory).toContain(comparison);
    }
    expect(writeMemory).not.toContain(
      "p_memory_key is not null and v_idempotent.memory_key <> p_memory_key",
    );
    expect(writeMemory).toMatch(
      /insert into public\.ai_hermes_memories \(\s*memory_key,\s*requested_memory_key,\s*requested_expected_revision,\s*idempotency_key/,
    );
    expect(writeMemory).toContain("memory_idempotency_conflict");
    expect(writeMemory.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      writeMemory.indexOf("into v_idempotent"),
    );
    expect(writeMemory.lastIndexOf("pg_advisory_xact_lock")).toBeLessThan(
      writeMemory.indexOf("into v_existing"),
    );
  });

  it("validates and normalizes claim actor fingerprints", () => {
    const claim = functionSql("claim_ai_hermes_broker_call");

    expect(claim).toContain(
      "lower(coalesce(p_actor_fingerprint, '')) !~ '^[0-9a-f]{64}$'",
    );
    expect(claim).toContain(
      "lower(p_actor_fingerprint) is distinct from v_capability.actor_fingerprint",
    );
  });

  it("validates direct Hermes writes without scanning legacy identity tables", () => {
    const capability = tableSql("ai_hermes_run_capabilities");
    const broker = tableSql("ai_hermes_broker_calls");
    const memory = tableSql("ai_hermes_memories");
    const draft = tableSql("ai_hermes_skill_drafts");

    expect(migration).not.toContain(
      "add constraint ai_invocations_identity_key unique",
    );
    expect(migration).not.toContain(
      "add constraint ai_chat_turns_identity_key unique",
    );
    expect(migration).not.toMatch(
      /alter table public\.ai_invocations[\s\S]{0,200}?add constraint[\s\S]{0,200}?unique/,
    );
    expect(migration).not.toMatch(
      /alter table public\.ai_chat_turns[\s\S]{0,200}?add constraint[\s\S]{0,200}?unique/,
    );
    expect(migration).not.toMatch(
      /create unique index(?: concurrently)?[^;]*?on public\.(ai_invocations|ai_chat_turns)/,
    );
    expect(migration).not.toContain("create unique index concurrently");
    expect(migration).not.toContain("ai_chat_turns_ai_invocation_tenant_fkey");
    expect(migration).not.toContain(
      "ai_chat_messages_ai_invocation_tenant_fkey",
    );

    expect(capability).toContain(
      "turn_id uuid not null references public.ai_chat_turns(id) on delete cascade",
    );
    expect(capability).toContain(
      "invocation_id uuid not null references public.ai_invocations(id) on delete cascade",
    );
    expect(capability).toContain(
      "root_invocation_id uuid not null references public.ai_invocations(id) on delete cascade",
    );
    expect(broker).toContain("owner_user_id uuid not null");
    expect(broker).toMatch(
      /foreign key \(capability_id, organization_id, owner_user_id\)\s+references public\.ai_hermes_run_capabilities\(id, organization_id, owner_user_id\)/,
    );
    expect(memory).toContain(
      "source_invocation_id uuid not null references public.ai_invocations(id)",
    );
    expect(draft).toContain(
      "source_invocation_id uuid not null references public.ai_invocations(id)",
    );

    const identityTriggers = [
      [
        "validate_ai_hermes_run_capability_identity",
        "ai_hermes_run_capabilities_validate_identity",
        "ai_hermes_run_capabilities",
      ],
      [
        "validate_ai_hermes_memory_identity",
        "ai_hermes_memories_validate_identity",
        "ai_hermes_memories",
      ],
      [
        "validate_ai_hermes_skill_draft_identity",
        "ai_hermes_skill_drafts_validate_identity",
        "ai_hermes_skill_drafts",
      ],
      [
        "validate_ai_hermes_broker_call_identity",
        "ai_hermes_broker_calls_validate_identity",
        "ai_hermes_broker_calls",
      ],
    ] as const;

    for (const [functionName, triggerName, tableName] of identityTriggers) {
      const fn = functionSql(functionName);
      expect(fn, functionName).toContain("security definer");
      expect(fn, functionName).toContain(
        "set search_path = pg_catalog, public",
      );
      expect(fn, functionName).toContain("returns trigger");
      expect(migration).toContain(
        `create trigger ${triggerName}\nbefore insert or update on public.${tableName}`,
      );
      expect(migration).toContain(`execute function public.${functionName}();`);
      expect(migration).toContain(
        `revoke all on function public.${functionName}() from public, anon, authenticated;`,
      );
    }

    const capabilityIdentity = functionSql(
      "validate_ai_hermes_run_capability_identity",
    );
    expect(capabilityIdentity).toContain("turn.id = new.turn_id");
    expect(capabilityIdentity).toContain(
      "turn.organization_id = new.organization_id",
    );
    expect(capabilityIdentity).toContain(
      "turn.owner_user_id = new.owner_user_id",
    );
    expect(capabilityIdentity).toContain(
      "turn.conversation_id = new.conversation_id",
    );
    expect(capabilityIdentity).toContain(
      "turn.ai_invocation_id = new.root_invocation_id",
    );
    expect(capabilityIdentity).toContain(
      "invocation.actor_user_id = new.owner_user_id",
    );
    expect(capabilityIdentity).toContain("hermes_capability_identity_invalid");

    const memoryIdentity = functionSql("validate_ai_hermes_memory_identity");
    expect(memoryIdentity).toContain("source_message.role = 'user'");
    expect(memoryIdentity).toContain(
      "source_invocation.actor_user_id = new.owner_user_id",
    );
    expect(memoryIdentity).toContain("hermes_memory_identity_invalid");

    expect(functionSql("validate_ai_hermes_skill_draft_identity")).toContain(
      "hermes_skill_draft_identity_invalid",
    );
    expect(functionSql("validate_ai_hermes_broker_call_identity")).toContain(
      "hermes_broker_call_identity_invalid",
    );
  });

  it("defers both legacy turn outcome checks for a later validation migration", () => {
    expect(migration).toMatch(
      /constraint ai_chat_turns_outcome_check check \([\s\S]*?\)\s+not valid,/,
    );
    expect(migration).toMatch(
      /constraint ai_chat_turns_outcome_status_check check \([\s\S]*?\)\s+not valid;/,
    );
    expect(migration).toContain(
      "validation is intentionally deferred to a later migration",
    );
    expect(migration).not.toContain(
      "validate constraint ai_chat_turns_outcome_check",
    );
    expect(migration).not.toContain(
      "validate constraint ai_chat_turns_outcome_status_check",
    );
  });

  it("revokes and grants the hardened RPC signatures exactly", () => {
    const issueSignature =
      "text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text[], text, text[], text, text, uuid[], integer, boolean, timestamptz";
    const claimSignature =
      "uuid, uuid, text, text, uuid, text, text, text, jsonb";
    const completeSignature =
      "uuid, uuid, uuid, uuid, bigint, text, jsonb, text, text, jsonb";
    const memorySignature =
      "uuid, uuid, text, uuid, text, uuid, integer, text, text, text, boolean, uuid, uuid, uuid";
    const forgetMemorySignature =
      "uuid, uuid, text, uuid, uuid, integer, uuid, uuid, uuid";

    for (const [name, signature] of [
      ["issue_ai_hermes_run_capability", issueSignature],
      ["claim_ai_hermes_broker_call", claimSignature],
      ["complete_ai_hermes_broker_call", completeSignature],
      ["write_ai_hermes_memory_revision", memorySignature],
      ["forget_ai_hermes_memory", forgetMemorySignature],
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${name}(\n  ${signature}\n) from public, anon, authenticated;`,
      );
      expect(migration).toContain(
        `grant execute on function public.${name}(\n  ${signature}\n) to service_role;`,
      );
    }
  });

  it("extends turns with exact outcomes, cancellation, and mode-aware leases", () => {
    const leaseTrigger = functionSql("refresh_ai_chat_turn_lease");
    const renewLease = functionSql("renew_ai_chat_turn_lease");
    const finishV2 = functionSql("finish_ai_chat_turn_v2");

    expect(migration).toContain(
      "alter table public.ai_chat_turns\n  add column if not exists outcome text",
    );
    expect(migration).toContain(
      "add column if not exists cancel_requested_at timestamptz",
    );
    expect(migration).toMatch(
      /constraint ai_chat_turns_outcome_check check \(\s*outcome is null or outcome in \(\s*'complete',\s*'partial',\s*'blocked',\s*'failed',\s*'cancelled'\s*\)\s*\)/,
    );
    expect(leaseTrigger).toMatch(
      /new\.lease_expires_at := now\(\) \+ case new\.mode\s+when 'fast' then interval '2 minutes'\s+when 'deep' then interval '6 minutes'\s+end/,
    );
    expect(renewLease).toMatch(
      /set lease_expires_at = now\(\) \+ case mode\s+when 'fast' then interval '2 minutes'\s+when 'deep' then interval '6 minutes'\s+end/,
    );
    expect(finishV2).toContain(
      "v_effective_outcome in ('complete', 'partial', 'blocked')",
    );
    expect(finishV2).toContain(
      "when v_effective_outcome in ('complete', 'partial', 'blocked') then 'completed'",
    );
    expect(finishV2).toContain(
      "when v_effective_outcome = 'failed' then 'failed'",
    );
    expect(finishV2).toContain(
      "when v_effective_outcome = 'cancelled' then 'cancelled'",
    );
  });

  it("makes cancellation terminal, idempotent, and dominant over late finishes", () => {
    const cancel = functionSql("cancel_ai_chat_turn");
    const finishV2 = functionSql("finish_ai_chat_turn_v2");

    expect(cancel).toContain("for update");
    expect(cancel).toContain(
      "('accepted', 'grounding', 'generating', 'validating')",
    );
    expect(cancel).not.toContain("lease_expires_at > now()");
    expect(cancel).toMatch(
      /update public\.ai_chat_messages\s+set status = 'failed'[\s\S]*?jsonb_build_object\('outcome', 'cancelled'\)/,
    );
    expect(cancel).toMatch(
      /update public\.ai_chat_turns\s+set status = 'cancelled',\s+outcome = 'cancelled',\s+cancel_requested_at = coalesce\(cancel_requested_at, now\(\)\)/,
    );
    expect(cancel).toContain("'already_terminal', true");
    expect(cancel).toContain("'status', 'cancelled'");
    expect(cancel).toContain("revoked_capability_ids");
    expect(cancel).toContain("child_sessions");
    expect(cancel).toMatch(/recursive\s+capability_lineage/i);
    expect(cancel).toContain("root_invocation_id = v_turn.ai_invocation_id");

    expect(finishV2).toContain(
      "when v_turn.cancel_requested_at is not null then 'cancelled'",
    );
    expect(finishV2).toContain("v_effective_outcome <> 'cancelled' and (");
    expect(finishV2).toContain(
      "jsonb_build_object('outcome', v_effective_outcome)",
    );
    expect(finishV2).toContain("outcome = v_effective_outcome");
  });

  it("claims clarify responses atomically in provider state before Gateway RPC", () => {
    const claim = functionSql("claim_ai_conversation_clarify_response");

    expect(claim).toContain("for update");
    expect(claim).toContain("p_organization_id uuid");
    expect(claim).toContain("p_owner_user_id uuid");
    expect(claim).toContain("p_conversation_id uuid");
    expect(claim).toContain("p_turn_id uuid");
    expect(claim).toContain("p_clarify_id text");
    expect(claim).toContain("p_answer_sha256 text");
    expect(claim).toContain("pendingclarify");
    expect(claim).toContain("'status', 'claimed'");
    expect(claim).toContain("'status', 'duplicate'");
    expect(claim).toContain("'status', 'conflict'");
    expect(claim).toContain("jsonb_set");
  });

  it("keeps atomic broker audit and standalone tool append locked", () => {
    const complete = functionSql("complete_ai_hermes_broker_call");
    const appendTool = functionSql("append_ai_hermes_tool_message");
    const updateState = functionSql("update_ai_conversation_hermes_state");

    expect(complete).toContain("from public.ai_conversations");
    expect(complete).toContain("for update");
    expect(complete).toContain("coalesce(max(sequence_no), 0) + 1");
    expect(complete).toContain("tool_message_id = v_message_id");

    expect(appendTool).toContain("from public.ai_conversations");
    expect(appendTool).toContain("for update");
    expect(appendTool).toContain("coalesce(max(sequence_no), 0) + 1");
    expect(appendTool).toContain("'tool'");

    expect(updateState).toContain("p_expected_generation integer");
    expect(updateState).toContain(
      "v_current_generation <> p_expected_generation",
    );
    expect(updateState).toContain("hermes_state_conflict");
    expect(updateState).toContain("jsonb_set");
  });

  it("keeps every write RPC service-only with a fixed search path", () => {
    for (const functionName of serviceOnlyFunctions) {
      const fn = functionSql(functionName);
      expect(fn, functionName).toContain("security definer");
      expect(fn, functionName).toContain(
        "set search_path = pg_catalog, public",
      );
      expect(migration, functionName).toContain(
        `revoke all on function public.${functionName}(`,
      );
      expect(migration, functionName).toContain(
        `grant execute on function public.${functionName}(`,
      );
    }
    expect(migration).not.toMatch(
      /grant execute on function public\.(issue_ai_hermes|claim_ai_hermes|complete_ai_hermes|append_ai_hermes|update_ai_conversation_hermes|write_ai_hermes|review_ai_hermes|cancel_ai_chat_turn|claim_ai_conversation_clarify_response|renew_ai_chat_turn_lease|finish_ai_chat_turn_v2)[^;]*to (anon|authenticated);/,
    );
  });

  it("fails closed on malformed control inputs and expired leases", () => {
    expect(functionSql("refresh_ai_chat_turn_lease")).toContain(
      "security definer",
    );
    expect(functionSql("issue_ai_hermes_run_capability")).toContain(
      "p_depth is null or p_ai_state_writes_allowed is null",
    );
    expect(functionSql("issue_ai_hermes_run_capability")).toContain(
      "turn.status in ('accepted', 'grounding', 'generating', 'validating')",
    );
    expect(functionSql("issue_ai_hermes_run_capability")).toContain(
      "turn.cancel_requested_at is null",
    );
    expect(functionSql("update_ai_conversation_hermes_state")).toContain(
      "p_expected_generation is null",
    );
    expect(functionSql("write_ai_hermes_memory_revision")).toContain(
      "p_active is distinct from true",
    );
    expect(functionSql("write_ai_hermes_skill_draft")).toContain(
      "p_version is null",
    );
    expect(functionSql("review_ai_hermes_skill_draft")).toContain(
      "p_next_status is null",
    );
    expect(functionSql("renew_ai_chat_turn_lease")).toContain(
      "lease_expires_at > now()",
    );
    const finishV2 = functionSql("finish_ai_chat_turn_v2");
    expect(finishV2).toContain("p_ai_invocation_id is null");
    expect(finishV2).toContain("p_retryable is null");
    expect(finishV2).toContain("v_turn.lease_expires_at <= now()");
  });

  it("allows authenticated owners to read only memories and drafts", () => {
    expect(migration).toContain(
      "alter table public.ai_hermes_memories enable row level security",
    );
    expect(migration).toContain(
      "alter table public.ai_hermes_skill_drafts enable row level security",
    );
    expect(migration).toMatch(
      /create policy ai_hermes_memories_owner_read[\s\S]*?for select[\s\S]*?owner_user_id = auth\.uid\(\)[\s\S]*?is_org_member\(organization_id\)/,
    );
    expect(migration).toMatch(
      /create policy ai_hermes_skill_drafts_owner_read[\s\S]*?for select[\s\S]*?owner_user_id = auth\.uid\(\)[\s\S]*?is_org_member\(organization_id\)/,
    );
    expect(migration).toContain(
      "grant select on table public.ai_hermes_memories to authenticated",
    );
    expect(migration).toContain(
      "grant select on table public.ai_hermes_skill_drafts to authenticated",
    );
    expect(migration).not.toMatch(
      /create policy .*?(ai_hermes_run_capabilities|ai_hermes_broker_calls)/,
    );
    expect(migration).not.toMatch(
      /create policy ai_hermes_(memories|skill_drafts).*?for (insert|update|delete)/,
    );
    expect(migration).not.toMatch(
      /grant (insert|update|delete|all).*ai_hermes_.*to (anon|authenticated)/,
    );
    for (const table of [
      "ai_hermes_run_capabilities",
      "ai_hermes_broker_calls",
      "ai_hermes_memories",
      "ai_hermes_skill_drafts",
    ]) {
      expect(migration).toContain(
        `grant all on table public.${table} to service_role`,
      );
    }
  });
});

describe.runIf(Boolean(structuredMemoryDbContainer))(
  "Xingyao Hermes structured-memory PostgreSQL behavior",
  () => {
    it("commits valid memory atomically, degrades invalid memory, deduplicates jobs, and rejects identity drift", () => {
      const container = structuredMemoryDbContainer ?? "";
      expect(container).toMatch(/^supabase_db_[A-Za-z0-9_.-]+$/u);

      const organizationId = "8f100000-0000-4000-8000-000000000001";
      const ownerId = "8f100000-0000-4000-8000-000000000002";
      const otherOwnerId = "8f100000-0000-4000-8000-000000000003";
      const conversationIds = {
        valid: "8f100000-0000-4000-8000-000000000101",
        degraded: "8f100000-0000-4000-8000-000000000102",
        drift: "8f100000-0000-4000-8000-000000000103",
      } as const;
      const turnIds = {
        valid: "8f100000-0000-4000-8000-000000000201",
        degraded: "8f100000-0000-4000-8000-000000000202",
        drift: "8f100000-0000-4000-8000-000000000203",
      } as const;
      const userMessageIds = {
        valid: "8f100000-0000-4000-8000-000000000301",
        degraded: "8f100000-0000-4000-8000-000000000303",
        drift: "8f100000-0000-4000-8000-000000000305",
      } as const;
      const assistantMessageIds = {
        valid: "8f100000-0000-4000-8000-000000000302",
        degraded: "8f100000-0000-4000-8000-000000000304",
        drift: "8f100000-0000-4000-8000-000000000306",
      } as const;
      const cleanup = `
        delete from public.organizations
        where id = '${organizationId}'::uuid;
        delete from public.profiles
        where id = '${ownerId}'::uuid;
        delete from auth.users
        where id = '${ownerId}'::uuid;
      `;

      try {
        runStructuredMemorySql(container, cleanup);
        const result = JSON.parse(
          runStructuredMemorySql(
            container,
            `
              insert into auth.users (id, email) values
                ('${ownerId}'::uuid, 'task5-memory@example.test');
              insert into public.profiles (id, email, full_name) values
                ('${ownerId}'::uuid, 'task5-memory@example.test', 'Task 5 Memory');
              insert into public.organizations (id, name, code) values
                ('${organizationId}'::uuid, 'Task 5 Memory', 'task5-memory');
              insert into public.organization_members (
                organization_id, user_id, role, status
              ) values (
                '${organizationId}'::uuid, '${ownerId}'::uuid, 'owner', 'active'
              );

              insert into public.ai_conversations (
                id, organization_id, owner_user_id, title
              ) values
                ('${conversationIds.valid}', '${organizationId}', '${ownerId}', 'Valid memory'),
                ('${conversationIds.degraded}', '${organizationId}', '${ownerId}', 'Degraded memory'),
                ('${conversationIds.drift}', '${organizationId}', '${ownerId}', 'Identity drift');

              insert into public.ai_chat_messages (
                id, organization_id, owner_user_id, conversation_id,
                sequence_no, role, status, content
              ) values
                ('${userMessageIds.valid}', '${organizationId}', '${ownerId}', '${conversationIds.valid}', 1, 'user', 'completed', 'Remember the corrected target.'),
                ('${assistantMessageIds.valid}', '${organizationId}', '${ownerId}', '${conversationIds.valid}', 2, 'assistant', 'pending', ''),
                ('${userMessageIds.degraded}', '${organizationId}', '${ownerId}', '${conversationIds.degraded}', 1, 'user', 'completed', 'Keep the response even if memory fails.'),
                ('${assistantMessageIds.degraded}', '${organizationId}', '${ownerId}', '${conversationIds.degraded}', 2, 'assistant', 'pending', ''),
                ('${userMessageIds.drift}', '${organizationId}', '${ownerId}', '${conversationIds.drift}', 1, 'user', 'completed', 'Reject identity drift.'),
                ('${assistantMessageIds.drift}', '${organizationId}', '${ownerId}', '${conversationIds.drift}', 2, 'assistant', 'pending', '');

              insert into public.ai_chat_turns (
                id, organization_id, owner_user_id, conversation_id,
                user_message_id, assistant_message_id, status,
                idempotency_key, lease_expires_at
              ) values
                ('${turnIds.valid}', '${organizationId}', '${ownerId}', '${conversationIds.valid}', '${userMessageIds.valid}', '${assistantMessageIds.valid}', 'generating', 'task5-valid', now() + interval '5 minutes'),
                ('${turnIds.degraded}', '${organizationId}', '${ownerId}', '${conversationIds.degraded}', '${userMessageIds.degraded}', '${assistantMessageIds.degraded}', 'generating', 'task5-degraded', now() + interval '5 minutes'),
                ('${turnIds.drift}', '${organizationId}', '${ownerId}', '${conversationIds.drift}', '${userMessageIds.drift}', '${assistantMessageIds.drift}', 'generating', 'task5-drift', now() + interval '5 minutes');

              do $task5$
              begin
              perform public.issue_ai_hermes_root_run_capability(
                repeat('1', 64), '${organizationId}', '${ownerId}', 'owner',
                '${conversationIds.valid}', '${turnIds.valid}', '${turnIds.valid}',
                null, null, repeat('a', 64), '{}'::text[],
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                '{}'::text[],
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                '{}'::uuid[], 0, false, now() + interval '5 minutes'
              );
              perform public.issue_ai_hermes_root_run_capability(
                repeat('2', 64), '${organizationId}', '${ownerId}', 'owner',
                '${conversationIds.degraded}', '${turnIds.degraded}', '${turnIds.degraded}',
                null, null, repeat('a', 64), '{}'::text[],
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                '{}'::text[],
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                '{}'::uuid[], 0, false, now() + interval '5 minutes'
              );
              perform public.issue_ai_hermes_root_run_capability(
                repeat('3', 64), '${organizationId}', '${ownerId}', 'owner',
                '${conversationIds.drift}', '${turnIds.drift}', '${turnIds.drift}',
                null, null, repeat('a', 64), '{}'::text[],
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                '{}'::text[],
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                public.ai_hermes_canonical_text_array_sha256('{}'::text[]),
                '{}'::uuid[], 0, false, now() + interval '5 minutes'
              );
              end;
              $task5$;

              create temporary table task5_results (
                name text primary key,
                payload jsonb not null
              );

              insert into task5_results values (
                'valid',
                public.finish_ai_chat_turn_v3(
                  '${organizationId}', '${ownerId}', '${turnIds.valid}',
                  'complete', 'Valid assistant response', 'hermes', '${turnIds.valid}',
                  null, null, false, '{}'::jsonb, 0,
                  jsonb_build_object(
                    'goals', '[]'::jsonb,
                    'confirmedFacts', jsonb_build_array(jsonb_build_object(
                      'text', 'The conversion target is 25%',
                      'sourceMessageIds', jsonb_build_array('${userMessageIds.valid}')
                    )),
                    'decisions', '[]'::jsonb,
                    'unresolvedQuestions', '[]'::jsonb,
                    'throughSequence', 1
                  )
                )
              );

              insert into task5_results values (
                'degraded-first',
                public.finish_ai_chat_turn_v3(
                  '${organizationId}', '${ownerId}', '${turnIds.degraded}',
                  'complete', 'Preserved assistant response', 'hermes', '${turnIds.degraded}',
                  null, null, false, '{}'::jsonb, 0, null
                )
              );
              insert into task5_results values (
                'degraded-retry',
                public.finish_ai_chat_turn_v3(
                  '${organizationId}', '${ownerId}', '${turnIds.degraded}',
                  'complete', 'Preserved assistant response', 'hermes', '${turnIds.degraded}',
                  null, null, false, '{}'::jsonb, 0, null
                )
              );
              insert into task5_results values (
                'identity-drift',
                public.finish_ai_chat_turn_v3(
                  '${organizationId}', '${otherOwnerId}', '${turnIds.drift}',
                  'complete', 'Must not persist', 'hermes', '${turnIds.drift}',
                  null, null, false, '{}'::jsonb, 0, null
                )
              );

              select jsonb_build_object(
                'validResult', (select payload from task5_results where name = 'valid'),
                'validConversation', (select jsonb_build_object(
                  'summary', summary,
                  'summaryVersion', summary_version,
                  'memoryStatus', memory_status
                ) from public.ai_conversations where id = '${conversationIds.valid}'),
                'validMessage', (select jsonb_build_object(
                  'status', status,
                  'content', content
                ) from public.ai_chat_messages where id = '${assistantMessageIds.valid}'),
                'validTurn', (select jsonb_build_object(
                  'status', status,
                  'outcome', outcome
                ) from public.ai_chat_turns where id = '${turnIds.valid}'),
                'validInvocationStatus', (select status from public.ai_invocations where id = '${turnIds.valid}'),
                'validCapabilityRevoked', (select revoked_at is not null from public.ai_hermes_run_capabilities where turn_id = '${turnIds.valid}'),
                'degradedFirst', (select payload from task5_results where name = 'degraded-first'),
                'degradedRetry', (select payload from task5_results where name = 'degraded-retry'),
                'degradedConversation', (select jsonb_build_object(
                  'summaryVersion', summary_version,
                  'memoryStatus', memory_status,
                  'memoryDegraded', memory_degraded_at is not null
                ) from public.ai_conversations where id = '${conversationIds.degraded}'),
                'degradedMessage', (select jsonb_build_object(
                  'status', status,
                  'content', content
                ) from public.ai_chat_messages where id = '${assistantMessageIds.degraded}'),
                'degradedTurnStatus', (select status from public.ai_chat_turns where id = '${turnIds.degraded}'),
                'degradedInvocationStatus', (select status from public.ai_invocations where id = '${turnIds.degraded}'),
                'degradedCapabilityRevoked', (select revoked_at is not null from public.ai_hermes_run_capabilities where turn_id = '${turnIds.degraded}'),
                'pendingJobs', (select count(*) from public.ai_conversation_memory_jobs where conversation_id = '${conversationIds.degraded}' and status = 'pending'),
                'identityResult', (select payload from task5_results where name = 'identity-drift'),
                'identityTurnStatus', (select status from public.ai_chat_turns where id = '${turnIds.drift}'),
                'identityMessageStatus', (select status from public.ai_chat_messages where id = '${assistantMessageIds.drift}'),
                'identityInvocationStatus', (select status from public.ai_invocations where id = '${turnIds.drift}'),
                'identityCapabilityRevoked', (select revoked_at is not null from public.ai_hermes_run_capabilities where turn_id = '${turnIds.drift}')
              );
            `,
          ),
        ) as Record<string, unknown>;

        expect(result).toMatchObject({
          validResult: {
            completed: true,
            memory_status: "ready",
            summary_version: 1,
          },
          validConversation: {
            summaryVersion: 1,
            memoryStatus: "ready",
            summary: {
              schemaVersion: 1,
              confirmedFacts: [
                {
                  text: "The conversion target is 25%",
                  sourceMessageIds: [userMessageIds.valid],
                },
              ],
              lastCompactedSequence: 1,
            },
          },
          validMessage: {
            status: "completed",
            content: "Valid assistant response",
          },
          validTurn: { status: "completed", outcome: "complete" },
          validInvocationStatus: "succeeded",
          validCapabilityRevoked: true,
          degradedFirst: {
            completed: true,
            memory_status: "degraded",
            summary_version: 0,
          },
          degradedRetry: {
            completed: true,
            memory_status: "degraded",
            summary_version: 0,
          },
          degradedConversation: {
            summaryVersion: 0,
            memoryStatus: "degraded",
            memoryDegraded: true,
          },
          degradedMessage: {
            status: "completed",
            content: "Preserved assistant response",
          },
          degradedTurnStatus: "completed",
          degradedInvocationStatus: "succeeded",
          degradedCapabilityRevoked: true,
          pendingJobs: 1,
          identityResult: { completed: false },
          identityTurnStatus: "generating",
          identityMessageStatus: "pending",
          identityInvocationStatus: "started",
          identityCapabilityRevoked: false,
        });
      } finally {
        runStructuredMemorySql(container, cleanup);
      }
    });
  },
);

function runStructuredMemorySql(container: string, sql: string): string {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: sql,
      timeout: 30_000,
      windowsHide: true,
    },
  );

  expect(
    result.status,
    `${result.stdout ?? ""}\n${result.stderr ?? result.error?.message ?? ""}`.slice(
      -4_000,
    ),
  ).toBe(0);
  return (result.stdout ?? "").trim();
}
