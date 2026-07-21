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

const serviceOnlyFunctions = [
  "issue_ai_hermes_run_capability",
  "claim_ai_hermes_broker_call",
  "complete_ai_hermes_broker_call",
  "append_ai_hermes_tool_message",
  "update_ai_conversation_hermes_state",
  "write_ai_hermes_memory_revision",
  "write_ai_hermes_skill_draft",
  "review_ai_hermes_skill_draft",
  "cancel_ai_chat_turn",
  "renew_ai_chat_turn_lease",
  "finish_ai_chat_turn_v2",
] as const;

describe("Xingyao Hermes native state schema contract", () => {
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
      "parent_invocation_id uuid",
      "actor_fingerprint text not null",
      "allowed_tools text[] not null",
      "allowed_tools_hash text not null",
      "scopes text[] not null",
      "scope_hash text not null",
      "skill_grants_hash text not null",
      "depth integer not null",
      "ai_state_writes_allowed boolean not null",
      "expires_at timestamptz not null",
      "revoked_at timestamptz",
      "last_used_at timestamptz",
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toContain("unique (token_sha256)");
    expect(table).toContain("depth >= 0");
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
    expect(table).toContain("unique (capability_id, tool_call_id)");
    expect(table).not.toMatch(/\n\s*(raw_response|response)\s+jsonb/);

    expect(claim).toContain("for update");
    expect(claim).toMatch(/token_sha256\s*=\s*lower\(p_token_sha256\)/);
    expect(claim).toMatch(/revoked_at\s+is\s+null/);
    expect(claim).toMatch(/expires_at\s*>\s*now\(\)/);
    expect(claim).toMatch(
      /turn\.ai_invocation_id\s*=\s*v_capability\.invocation_id/,
    );
    expect(claim).toMatch(/turn\.lease_expires_at\s*>\s*now\(\)/);
    expect(claim).toContain(
      "turn.status in ('accepted', 'grounding', 'generating', 'validating')",
    );
    expect(claim).toContain(
      "p_actor_fingerprint is distinct from v_capability.actor_fingerprint",
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
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toMatch(
      /memory_type in \(\s*'preference',\s*'workflow',\s*'communication',\s*'user_instruction'\s*\)/,
    );
    expect(table).toContain("revision > 0");
  });

  it("validates memory provenance against the exact owner user message", () => {
    const writeMemory = functionSql("write_ai_hermes_memory_revision");

    expect(writeMemory).toContain(
      "from public.ai_chat_messages source_message",
    );
    expect(writeMemory).toContain("source_message.role = 'user'");
    expect(writeMemory).toContain(
      "source_message.organization_id = p_organization_id",
    );
    expect(writeMemory).toContain(
      "source_message.owner_user_id = p_owner_user_id",
    );
    expect(writeMemory).toContain(
      "source_message.conversation_id = p_source_conversation_id",
    );
    expect(writeMemory).toContain("memory_source_invalid");
    expect(writeMemory).toContain("expected_revision");
    expect(writeMemory).toContain("deactivated_at");
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

    expect(finishV2).toContain(
      "when v_turn.cancel_requested_at is not null then 'cancelled'",
    );
    expect(finishV2).toContain("v_effective_outcome <> 'cancelled' and (");
    expect(finishV2).toContain(
      "jsonb_build_object('outcome', v_effective_outcome)",
    );
    expect(finishV2).toContain("outcome = v_effective_outcome");
  });

  it("keeps tool append locked and provider-state updates compare-and-swap", () => {
    const appendTool = functionSql("append_ai_hermes_tool_message");
    const updateState = functionSql("update_ai_conversation_hermes_state");

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
      /grant execute on function public\.(issue_ai_hermes|claim_ai_hermes|complete_ai_hermes|append_ai_hermes|update_ai_conversation_hermes|write_ai_hermes|review_ai_hermes|cancel_ai_chat_turn|renew_ai_chat_turn_lease|finish_ai_chat_turn_v2)[^;]*to (anon|authenticated);/,
    );
  });

  it("fails closed on malformed control inputs and expired leases", () => {
    expect(functionSql("refresh_ai_chat_turn_lease")).toContain(
      "security definer",
    );
    expect(functionSql("issue_ai_hermes_run_capability")).toContain(
      "p_depth is null or p_ai_state_writes_allowed is null",
    );
    expect(functionSql("update_ai_conversation_hermes_state")).toContain(
      "p_expected_generation is null",
    );
    expect(functionSql("write_ai_hermes_memory_revision")).toContain(
      "p_active is null",
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
