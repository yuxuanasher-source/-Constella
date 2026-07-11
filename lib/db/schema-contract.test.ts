import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { businessRuleContractSchema } from "../../features/settlements/custom-rule-contract";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260601161000_initial_foundation.sql",
  ),
  "utf8",
);
const migrationsDir = join(process.cwd(), "supabase", "migrations");
const allMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");
const settlementAiMigrationName =
  "20260711110000_custom_settlement_rule_authoring.sql";
const settlementAiMigration = readdirSync(migrationsDir).includes(
  settlementAiMigrationName,
)
  ? readFileSync(join(migrationsDir, settlementAiMigrationName), "utf8")
  : "";
const normalizedSettlementAiMigration = settlementAiMigration
  .toLowerCase()
  .replace(/\s+/gu, " ")
  .trim();

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/gu, " ").trim();
}

function extractBalancedSql(
  sql: string,
  marker: string,
): { full: string; inner: string } {
  const normalizedSql = sql.toLowerCase();
  const markerIndex = normalizedSql.indexOf(marker.toLowerCase());
  expect(markerIndex, `missing SQL marker: ${marker}`).toBeGreaterThanOrEqual(0);
  const openIndex = sql.indexOf("(", markerIndex + marker.length);
  expect(openIndex, `missing opening parenthesis after: ${marker}`).toBeGreaterThan(
    markerIndex,
  );

  let depth = 0;
  let inString = false;
  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inString && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          full: sql.slice(markerIndex, index + 1),
          inner: sql.slice(openIndex + 1, index),
        };
      }
    }
  }
  throw new Error(`unbalanced SQL after marker: ${marker}`);
}

function settlementAiTableDefinition(table: string): string {
  return normalizeSql(
    extractBalancedSql(
      settlementAiMigration,
      `create table public.${table}`,
    ).inner,
  );
}

function extractSettlementAiFunction(fn: string): {
  definition: string;
  header: string;
  body: string;
} {
  const marker = `create or replace function public.${fn}`;
  const start = settlementAiMigration.toLowerCase().indexOf(marker);
  expect(start, `missing SQL function: ${fn}`).toBeGreaterThanOrEqual(0);
  const bodyMarker = /\bas\s+\$\$/giu;
  bodyMarker.lastIndex = start;
  const bodyStartMatch = bodyMarker.exec(settlementAiMigration);
  expect(bodyStartMatch, `missing function body: ${fn}`).not.toBeNull();
  const bodyStart = bodyStartMatch?.index ?? -1;
  const bodyContentStart = bodyStart + (bodyStartMatch?.[0].length ?? 0);
  const bodyEnd = settlementAiMigration.indexOf("$$;", bodyContentStart);
  expect(bodyEnd, `missing function terminator: ${fn}`).toBeGreaterThan(
    bodyContentStart,
  );
  return {
    definition: settlementAiMigration.slice(start, bodyEnd + 3),
    header: settlementAiMigration.slice(start, bodyStart),
    body: settlementAiMigration.slice(bodyContentStart, bodyEnd),
  };
}

function settlementAiFunctionDefinition(fn: string): string {
  return normalizeSql(extractSettlementAiFunction(fn).definition);
}

function settlementAiFunctionBody(fn: string): string {
  return normalizeSql(extractSettlementAiFunction(fn).body);
}

function settlementAiPolicyDefinition(policy: string): string {
  const marker = `create policy ${policy}`;
  const start = normalizedSettlementAiMigration.indexOf(marker);
  expect(start, `missing SQL policy: ${policy}`).toBeGreaterThanOrEqual(0);
  const end = normalizedSettlementAiMigration.indexOf(";", start);
  expect(end, `missing policy terminator: ${policy}`).toBeGreaterThan(start);
  return normalizedSettlementAiMigration.slice(start, end + 1);
}

function settlementAiCheckDefinition(
  table: string,
  constraint: string,
): string {
  const tableDefinition = settlementAiTableDefinition(table);
  return normalizeSql(
    extractBalancedSql(
      tableDefinition,
      `constraint ${constraint} check`,
    ).full,
  );
}

function settlementAiSelfCheckSource(): string {
  const marker = "-- settlement_ai_validator_self_checks";
  const start = settlementAiMigration.indexOf(marker);
  expect(start, "missing validator self-check marker").toBeGreaterThanOrEqual(0);
  const blockStart = settlementAiMigration.indexOf("do $$", start);
  const blockEnd = settlementAiMigration.indexOf("$$;", blockStart);
  expect(blockStart).toBeGreaterThan(start);
  expect(blockEnd).toBeGreaterThan(blockStart);
  return settlementAiMigration.slice(blockStart, blockEnd + 3);
}

function settlementAiSelfCheckBlock(): string {
  return normalizeSql(settlementAiSelfCheckSource());
}

function settlementAiCanonicalBusinessContract(): unknown {
  const match = settlementAiSelfCheckSource().match(
    /v_valid_contract\s+jsonb\s*:=\s*\$contract\$\s*([\s\S]*?)\s*\$contract\$::jsonb;/u,
  );
  expect(match, "missing canonical business contract fixture").not.toBeNull();
  return JSON.parse(match?.[1] ?? "null") as unknown;
}

describe("P0 database contract", () => {
  it("declares the required foundation and reference tables", () => {
    const requiredTables = [
      "organizations",
      "profiles",
      "organization_members",
      "streamers",
      "auto_review_rules",
      "live_reports",
      "projects",
      "live_tasks",
      "suppliers",
      "settlement_batch_items",
      "report_screenshots",
      "ocr_results",
      "report_change_logs",
      "review_samples",
      "audit_logs",
      "notifications",
    ];

    for (const table of requiredTables) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("defines RLS helper functions and enables RLS on business tables", () => {
    const requiredFunctions = [
      "public.is_org_member",
      "public.current_user_role",
      "public.is_mcn_staff",
      "public.current_streamer_id",
      "public.can_access_project",
    ];

    for (const fn of requiredFunctions) {
      expect(migration).toContain(`function ${fn}`);
    }

    expect(migration).toContain(
      "alter table public.live_reports enable row level security",
    );
    expect(migration).toContain(
      "alter table public.projects enable row level security",
    );
  });

  it("locks audit logs and exposes a safe streamer payable view", () => {
    expect(migration).toContain("audit_logs are append-only");
    expect(migration).toContain("public.streamer_payable_items_safe");
    expect(migration).toContain("where sb.batch_type = 'payable'");
  });

  it("allows staff review flows to append report change logs through RLS", () => {
    expect(allMigrations).toContain("report_change_logs_staff_insert");
    expect(allMigrations).toContain("on public.report_change_logs");
    expect(allMigrations).toContain("for insert");
    expect(allMigrations).toContain("public.can_access_project(lr.project_id)");
  });

  it("allows MCN staff to read organization live queues after streamer updates", () => {
    expect(allMigrations).toContain("mcn staff can read live tasks in org");
    expect(allMigrations).toContain("mcn staff can read live reports in org");
    expect(allMigrations).toContain("public.is_mcn_staff(organization_id)");
    expect(allMigrations).toContain(
      "streamer_id = public.current_streamer_id(organization_id)",
    );
  });

  it("allows business operators to read project drafts they created", () => {
    expect(allMigrations).toContain("function public.can_access_project");
    expect(allMigrations).toContain("project creators can read own projects");
    expect(allMigrations).toContain("created_by = auth.uid()");
  });

  it("allows project creators and owners to update accessible project drafts", () => {
    expect(allMigrations).toContain("project creators can update own projects");
    expect(allMigrations).toContain("public.can_access_project(id)");
    expect(allMigrations).toContain("owner_id = auth.uid()");
    expect(allMigrations).toContain("created_by = auth.uid()");
  });

  it("defaults project owners to the project creator", () => {
    expect(allMigrations).toContain("function public.default_project_owner");
    expect(allMigrations).toContain(
      "new.owner_id := coalesce(new.owner_id, new.created_by)",
    );
    expect(allMigrations).toContain("update public.projects");
    expect(allMigrations).toContain("set owner_id = created_by");
  });

  it("declares public streamer project announcement fields", () => {
    expect(allMigrations).toContain(
      "is_public_to_streamers boolean not null default false",
    );
    expect(allMigrations).toContain("public_summary text not null default ''");
    expect(allMigrations).toContain("game_download_url text");
    expect(allMigrations).toContain("projects_game_download_url_http");
    expect(allMigrations).toContain("projects_org_public_streamer_idx");
    expect(allMigrations).toContain(
      "create or replace view public.streamer_public_project_announcements",
    );
    expect(allMigrations).toContain(
      "grant select on public.streamer_public_project_announcements to authenticated",
    );
    expect(allMigrations).toContain(
      "public.current_streamer_id(organization_id)",
    );
    expect(allMigrations).toContain(
      "function public.mark_application_recording_reviewing",
    );
    expect(allMigrations).toContain(
      "revoke all on function public.mark_application_recording_reviewing(uuid)",
    );
    expect(allMigrations).toContain("from public");
    expect(allMigrations).toContain("status = 'recording_reviewing'");
    expect(allMigrations).not.toContain(
      'create policy "streamers can read public projects"',
    );
  });

  it("keeps current streamer resolution deterministic for RLS checks", () => {
    expect(allMigrations).toContain(
      "create or replace function public.current_streamer_id(target_organization_id uuid)",
    );
    expect(allMigrations).toContain("order by s.created_at desc, s.id desc");
  });

  it("extends audit actions for admission recording share workflows", () => {
    expect(allMigrations).toContain(
      "add value if not exists 'create_share_board'",
    );
    expect(allMigrations).toContain(
      "add value if not exists 'revoke_share_board'",
    );
    expect(allMigrations).toContain(
      "add value if not exists 'vendor_review_submit'",
    );
    expect(allMigrations).toContain(
      "add value if not exists 'vendor_review_sync'",
    );
  });

  it("declares streamer default settlement cps snapshot fields", () => {
    expect(allMigrations).toContain(
      "default_cps_rate_bps integer not null default 0",
    );
    expect(allMigrations).toContain("streamers_default_cps_rate_bps_range");
    expect(allMigrations).toContain("cps_rate_bps integer not null default 0");
    expect(allMigrations).toContain("project_streamers_cps_rate_bps_range");
    expect(allMigrations).toContain(
      "default_cps_rate_bps >= 0 and default_cps_rate_bps <= 10000",
    );
    expect(allMigrations).toContain(
      "cps_rate_bps >= 0 and cps_rate_bps <= 10000",
    );
  });

  it("declares the public MCN onboarding request intake table", () => {
    expect(allMigrations).toContain(
      "create table public.mcn_onboarding_requests",
    );
    expect(allMigrations).toContain(
      "alter table public.mcn_onboarding_requests enable row level security",
    );
    expect(allMigrations).toContain(
      'create policy "public can submit mcn onboarding requests"',
    );
  });

  it("declares the owner-scoped Xingyao conversation ledger", () => {
    for (const table of [
      "ai_conversations",
      "ai_chat_messages",
      "ai_chat_turns",
    ]) {
      expect(allMigrations).toContain(`create table public.${table}`);
      expect(allMigrations).toContain(
        `alter table public.${table} enable row level security`,
      );
    }

    expect(allMigrations).toContain("ai_chat_messages_conversation_sequence_key");
    expect(allMigrations).toContain("ai_chat_turns_owner_idempotency_key");
    expect(allMigrations).toContain("ai_chat_turns_one_active_per_conversation");
    expect(allMigrations).toContain("lease_expires_at timestamptz");
    expect(allMigrations).toContain("turn_lease_expired");
    expect(allMigrations).toContain("ai_chat_turns_one_retry_successor");
    expect(allMigrations).toContain("ai_chat_turns_one_regenerate_successor");
    expect(allMigrations).toContain("source_turn_already_replaced");
    expect(allMigrations).toContain("with recursive regeneration_lineage");
    expect(allMigrations).toContain(
      "create or replace function public.renew_ai_chat_turn_lease",
    );
    expect(allMigrations).toContain("v_stale_message_ids uuid[]");
    expect(allMigrations).toContain("v_conversation_id uuid");
    expect(allMigrations).toContain("owner_user_id = auth.uid()");
    expect(allMigrations).toContain("ai_conversations_owner_access");
    expect(allMigrations).toContain("ai_chat_messages_owner_read");
    expect(allMigrations).toContain("ai_chat_turns_owner_read");
    expect(allMigrations).toContain(
      "create or replace function public.create_ai_chat_turn",
    );
    expect(allMigrations).toContain(
      "create or replace function public.finish_ai_chat_turn",
    );
    expect(allMigrations).toContain(
      "revoke all on function public.create_ai_chat_turn",
    );
    expect(allMigrations).toContain(
      "revoke all on function public.finish_ai_chat_turn",
    );
  });
});

describe("Phase 1 settlement AI persistence contract", () => {
  it("declares complete draft and summary-only simulation storage", () => {
    expect(settlementAiMigration).not.toBe("");

    const draft = settlementAiTableDefinition("ai_settlement_rule_drafts");
    for (const column of [
      "id uuid primary key",
      "organization_id uuid not null",
      "project_id uuid not null",
      "conversation_id uuid not null",
      "prompt_text text not null",
      "turn_trace jsonb not null",
      "business_contract jsonb not null",
      "unresolved_ambiguities jsonb not null",
      "variable_catalog_version text not null",
      "ai_response jsonb not null",
      "generated_formula jsonb",
      "generated_explanation text",
      "generated_test_cases jsonb not null",
      "model text not null",
      "safety_flags jsonb not null",
      "contract_hash text not null",
      "formula_hash text",
      "parameter_hash text not null",
      "initial_status text not null",
      "status text not null",
      "revision_number integer not null",
      "idempotency_key text not null",
      "request_fingerprint text not null",
      "created_by uuid not null",
      "created_at timestamptz not null",
      "supersedes_draft_id uuid",
      "superseded_by_draft_id uuid",
      "superseded_at timestamptz",
    ]) {
      expect(draft).toContain(column);
    }
    expect(draft).not.toContain("generated_formula jsonb not null");
    expect(draft).not.toContain("generated_explanation text not null");
    expect(draft).not.toContain("formula_hash text not null");

    const simulation = settlementAiTableDefinition(
      "settlement_formula_simulations",
    );
    for (const column of [
      "rule_version_id uuid",
      "ai_draft_id uuid",
      "formula_hash text not null",
      "rule_contract_hash text not null",
      "parameter_hash text not null",
      "variable_catalog_version text not null",
      "data_selection_hash text not null",
      "sample_source jsonb not null",
      "sample_selection jsonb not null",
      "coverage jsonb not null",
      "scenarios jsonb not null",
      "historical_totals jsonb not null",
      "deltas jsonb not null",
      "largest_changes jsonb not null",
      "warnings jsonb not null",
      "idempotency_key text not null",
      "created_by uuid not null",
      "created_at timestamptz not null",
    ]) {
      expect(simulation).toContain(column);
    }
    expect(simulation).not.toMatch(
      /raw_(?:sample|report|import)|source_payload|parsed_payload|streamer_amount|internal_margin|tax/u,
    );
  });

  it("enforces project, conversation, revision, and exactly-one-owner integrity", () => {
    const draft = settlementAiTableDefinition("ai_settlement_rule_drafts");
    const simulation = settlementAiTableDefinition(
      "settlement_formula_simulations",
    );

    expect(normalizedSettlementAiMigration).toContain(
      "constraint projects_id_organization_key unique (id, organization_id)",
    );
    expect(normalizedSettlementAiMigration).toContain(
      "add column project_id uuid",
    );
    expect(normalizedSettlementAiMigration).toContain(
      "constraint ai_conversations_project_scope_fkey foreign key (project_id, organization_id) references public.projects(id, organization_id)",
    );
    expect(draft).toContain(
      "constraint ai_settlement_rule_drafts_project_scope_fkey foreign key (project_id, organization_id) references public.projects(id, organization_id)",
    );
    expect(draft).toContain(
      "constraint ai_settlement_rule_drafts_conversation_scope_fkey foreign key (conversation_id, organization_id, project_id) references public.ai_conversations(id, organization_id, project_id)",
    );
    expect(draft).toContain(
      "constraint ai_settlement_rule_drafts_conversation_revision_key unique (conversation_id, revision_number)",
    );
    expect(draft).toContain(
      "constraint ai_settlement_rule_drafts_revision_positive check (revision_number > 0)",
    );
    expect(draft).toContain(
      "status in ('clarifying', 'contract_ready', 'simulated', 'failed', 'superseded')",
    );
    expect(draft).toContain(
      "initial_status in ('clarifying', 'contract_ready', 'failed')",
    );
    expect(simulation).toContain(
      "constraint settlement_formula_simulations_exactly_one_owner check (((rule_version_id is not null)::integer + (ai_draft_id is not null)::integer = 1))",
    );
    expect(simulation).toContain(
      "constraint settlement_formula_simulations_draft_scope_fkey foreign key (ai_draft_id, organization_id, project_id) references public.ai_settlement_rule_drafts(id, organization_id, project_id)",
    );
    expect(simulation).not.toMatch(/foreign key \(rule_version_id/u);
    expect(simulation).not.toMatch(/rule_version_id uuid references/u);
  });

  it("persists and validates the immutable initial draft formula state", () => {
    const validator = extractSettlementAiFunction(
      "settlement_ai_draft_formula_state_is_valid",
    );
    const header = normalizeSql(validator.header);
    const body = normalizeSql(validator.body);
    const tableCheck = settlementAiCheckDefinition(
      "ai_settlement_rule_drafts",
      "ai_settlement_rule_drafts_formula_state_valid",
    );
    const createDraft = settlementAiFunctionBody(
      "create_ai_settlement_rule_draft",
    );
    const createSimulation = settlementAiFunctionBody(
      "create_settlement_formula_simulation",
    );

    expect(header).toContain("returns boolean");
    expect(header).toContain("stable");
    expect(header).toContain("set search_path = pg_catalog, public");
    expect(body).not.toMatch(/^begin return true; end;$/u);
    expect(body).toContain("p_generated_formula is null");
    expect(body).toContain("p_generated_explanation is null");
    expect(body).toContain("p_generated_test_cases = '[]'::jsonb");
    expect(body).toContain("p_formula_hash is null");
    expect(body).toContain(
      "pg_catalog.jsonb_array_length(p_unresolved_ambiguities) > 0",
    );
    expect(body).toContain(
      "pg_catalog.jsonb_array_length(p_unresolved_ambiguities) = 0",
    );
    expect(body).toContain(
      "public.settlement_ai_generated_formula_is_valid(p_generated_formula)",
    );
    expect(body).toMatch(
      /public\.settlement_ai_generated_test_cases_is_valid\(\s*p_generated_test_cases\s*\)/u,
    );
    expect(body).toContain("p_status = 'simulated'");
    expect(body).toContain("p_initial_status <> 'contract_ready'");
    expect(tableCheck).toContain(
      "public.settlement_ai_draft_formula_state_is_valid(",
    );
    expect(tableCheck).toContain("initial_status");
    expect(tableCheck).toContain("status");
    const precheck = createDraft.indexOf(
      "public.settlement_ai_draft_formula_state_is_valid(",
    );
    expect(precheck).toBeGreaterThanOrEqual(0);
    expect(precheck).toBeLessThan(
      createDraft.indexOf("insert into public.ai_settlement_rule_drafts"),
    );
    expect(createDraft).toMatch(
      /insert into public\.ai_settlement_rule_drafts \([^)]*initial_status/iu,
    );
    expect(createDraft).toContain(
      "v_existing.generated_explanation is distinct from pg_catalog.btrim(p_generated_explanation)",
    );
    expect(createDraft).toContain(
      "v_existing.formula_hash is distinct from p_formula_hash",
    );
    expect(createSimulation).toContain(
      "v_draft.initial_status <> 'contract_ready'",
    );
  });

  it("adds useful scope, status, conversation, owner, and recency indexes", () => {
    for (const index of [
      "ai_settlement_rule_drafts_org_project_status_recent_idx",
      "ai_settlement_rule_drafts_conversation_recent_idx",
      "ai_settlement_rule_drafts_created_by_idempotency_key",
      "settlement_formula_simulations_org_project_recent_idx",
      "settlement_formula_simulations_ai_draft_recent_idx",
      "settlement_formula_simulations_rule_version_recent_idx",
      "settlement_formula_simulations_created_by_idempotency_key",
    ]) {
      expect(normalizedSettlementAiMigration).toContain(index);
    }
    expect(normalizedSettlementAiMigration).toMatch(
      /on public\.settlement_formula_simulations \(\s*ai_draft_id,\s*created_at desc,\s*id desc\s*\)/u,
    );
    expect(normalizedSettlementAiMigration).toMatch(
      /on public\.settlement_formula_simulations \(\s*rule_version_id,\s*created_at desc,\s*id desc\s*\)/u,
    );
  });

  it("allows only project-scoped MCN reads and removes direct client writes", () => {
    for (const table of [
      "ai_settlement_rule_drafts",
      "settlement_formula_simulations",
    ]) {
      expect(normalizedSettlementAiMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(normalizedSettlementAiMigration).toContain(
        `revoke all on table public.${table} from public, anon, authenticated, service_role`,
      );
      expect(normalizedSettlementAiMigration).toContain(
        `grant select on table public.${table} to authenticated`,
      );
    }
    for (const policy of [
      "ai_settlement_rule_drafts_mcn_project_read",
      "settlement_formula_simulations_mcn_project_read",
    ]) {
      expect(normalizedSettlementAiMigration).toContain(
        `create policy ${policy}`,
      );
    }
    expect(normalizedSettlementAiMigration).toContain(
      "auth.uid() is not null and public.is_org_member(organization_id) and public.is_mcn_staff(organization_id) and public.can_access_project(project_id)",
    );
    expect(normalizedSettlementAiMigration).not.toMatch(
      /create policy [^;]+ for (?:insert|update|delete)/u,
    );
  });

  it("hardens RPC writes, monotonic revisions, JSON safety, and immutability", () => {
    const createDraft = settlementAiFunctionDefinition(
      "create_ai_settlement_rule_draft",
    );
    const createSimulation = settlementAiFunctionDefinition(
      "create_settlement_formula_simulation",
    );

    for (const fn of [createDraft, createSimulation]) {
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = pg_catalog, public");
      expect(fn).toContain("auth.uid()");
      expect(fn).toContain("public.is_org_member");
      expect(fn).toContain("public.is_mcn_staff");
      expect(fn).toContain("public.can_access_project");
      expect(fn).toContain("settlement_ai_json_is_safe");
    }
    expect(createDraft).toContain("for update");
    expect(createDraft).toContain(
      "coalesce(max(d.revision_number), 0) + 1",
    );
    expect(createDraft).toContain("owner_user_id = auth.uid()");
    expect(createSimulation).toContain(
      "((p_rule_version_id is not null)::integer + (p_ai_draft_id is not null)::integer) <> 1",
    );
    const phaseOneOwnerGate = createSimulation.indexOf(
      "if p_rule_version_id is not null then",
    );
    expect(phaseOneOwnerGate).toBeGreaterThanOrEqual(0);
    expect(createSimulation).toContain(
      "settlement_ai_rule_version_owner_phase1_unsupported",
    );
    expect(createSimulation).toContain("if p_ai_draft_id is null then");
    expect(phaseOneOwnerGate).toBeLessThan(
      createSimulation.indexOf(
        "insert into public.settlement_formula_simulations",
      ),
    );
    expect(createSimulation).toContain("d.organization_id = p_organization_id");
    expect(createSimulation).toContain("d.project_id = p_project_id");

    for (const fn of [
      "create_ai_settlement_rule_draft",
      "create_settlement_formula_simulation",
    ]) {
      expect(normalizedSettlementAiMigration).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\([^;]+\\) from public, anon, authenticated, service_role;`,
          "u",
        ),
      );
      expect(normalizedSettlementAiMigration).toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}\\([^;]+\\) to authenticated;`,
          "u",
        ),
      );
      expect(normalizedSettlementAiMigration).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}\\([^;]+\\) to service_role;`,
          "u",
        ),
      );
    }

    expect(normalizedSettlementAiMigration).toContain(
      "create trigger ai_settlement_rule_drafts_guard before update or delete on public.ai_settlement_rule_drafts",
    );
    expect(normalizedSettlementAiMigration).toContain(
      "create trigger settlement_formula_simulations_immutable before update or delete on public.settlement_formula_simulations",
    );
    expect(normalizedSettlementAiMigration).toContain(
      "settlement_formula_simulations are append-only",
    );
    expect(normalizedSettlementAiMigration).toContain(
      "only contract_ready to simulated and supersession transitions are allowed",
    );
  });

  it("binds draft traces to the locked completed Xingyao turn and message pair", () => {
    const body = settlementAiFunctionBody("create_ai_settlement_rule_draft");
    const fingerprint = body.indexOf("v_request_fingerprint :=");
    const conversationLock = body.indexOf("from public.ai_conversations as c");
    const existingLookup = body.indexOf(
      "from public.ai_settlement_rule_drafts as d",
    );
    const duplicateReturn = body.indexOf(
      "pg_catalog.jsonb_build_object('duplicate', true)",
    );
    const turnLock = body.indexOf("from public.ai_chat_turns as trace_turn");

    expect(body).toMatch(
      /pg_catalog\.jsonb_typeof\(p_turn_trace -> 'turnid'\) <> 'string'/u,
    );
    expect(body).toMatch(
      /v_trace_turn_id := \(p_turn_trace ->> 'turnid'\)::uuid/u,
    );
    expect(body).toMatch(
      /v_trace_user_message_id := \(p_turn_trace ->> 'usermessageid'\)::uuid/u,
    );
    expect(body).toMatch(
      /v_trace_assistant_message_id := \(p_turn_trace ->> 'assistantmessageid'\)::uuid/u,
    );
    expect(fingerprint).toBeGreaterThanOrEqual(0);
    expect(conversationLock).toBeGreaterThanOrEqual(0);
    expect(conversationLock).toBeGreaterThan(fingerprint);
    expect(existingLookup).toBeGreaterThan(conversationLock);
    expect(existingLookup).toBeLessThan(turnLock);
    expect(duplicateReturn).toBeGreaterThan(existingLookup);
    expect(duplicateReturn).toBeLessThan(turnLock);
    expect(turnLock).toBeGreaterThan(conversationLock);
    expect(body).toContain("d.organization_id = p_organization_id");
    expect(body).toContain("d.created_by = v_actor_id");
    expect(body).toContain(
      "d.idempotency_key = pg_catalog.btrim(p_idempotency_key)",
    );
    expect(body).toContain("trace_turn.conversation_id = p_conversation_id");
    expect(body).toContain("trace_turn.organization_id = p_organization_id");
    expect(body).toContain("trace_turn.owner_user_id = v_actor_id");
    expect(body).toContain("trace_turn.user_message_id = v_trace_user_message_id");
    expect(body).toContain(
      "trace_turn.assistant_message_id = v_trace_assistant_message_id",
    );
    expect(body).toContain("trace_turn.status = 'completed'");
    expect(body).toContain("for update of trace_turn");
    expect(body).toContain("from public.ai_chat_messages as user_message");
    expect(body).toContain(
      "join public.ai_chat_messages as assistant_message",
    );
    expect(body).toContain("user_message.role = 'user'");
    expect(body).toContain("assistant_message.role = 'assistant'");
    expect(body).toContain("user_message.status = 'completed'");
    expect(body).toContain("assistant_message.status = 'completed'");
    expect(body).toContain(
      "assistant_message.parent_message_id = user_message.id",
    );
    expect(body).toContain(
      "assistant_message.sequence_no > user_message.sequence_no",
    );
    expect(body).toContain(
      "assistant_message.content = p_ai_response ->> 'content'",
    );
    expect(body).toContain("for update of user_message, assistant_message");
  });

  it("validates the full SQL business contract before table or RPC writes", () => {
    const validator = extractSettlementAiFunction(
      "settlement_ai_business_contract_is_valid",
    );
    const header = normalizeSql(validator.header);
    const body = normalizeSql(validator.body);
    const identifierBody = settlementAiFunctionBody(
      "settlement_ai_identifier_is_valid",
    );
    const tableCheck = settlementAiCheckDefinition(
      "ai_settlement_rule_drafts",
      "ai_settlement_rule_drafts_business_contract_valid",
    );
    const createDraft = settlementAiFunctionBody(
      "create_ai_settlement_rule_draft",
    );
    const offsetDatetimeBody = settlementAiFunctionBody(
      "settlement_ai_offset_datetime_is_valid",
    );
    const selfChecks = settlementAiSelfCheckBlock();

    expect(header).toContain("returns boolean");
    expect(header).toContain("language plpgsql");
    expect(header).toContain("stable");
    expect(header).toContain("set search_path = pg_catalog, public");
    expect(body).not.toMatch(/^begin return true; end;$/u);
    expect(body.match(/return false/gu)?.length ?? 0).toBeGreaterThan(5);
    expect(body).toContain("public.settlement_ai_json_has_exact_keys");
    expect(body).toContain("public.settlement_ai_runtime_type_is_valid");
    expect(body).toContain("public.settlement_ai_typed_value_is_valid");
    expect(body).toContain("public.settlement_ai_runtime_value_matches_type");
    expect(normalizedSettlementAiMigration).not.toContain(
      "pg_catalog.nullif(",
    );
    expect(body).toContain("nullif(");
    expect(body).toContain("from pg_catalog.pg_timezone_names as timezone");
    expect(body).toContain("pg_catalog.jsonb_array_elements");
    expect(body).toContain("v_normal_examples");
    expect(body).toContain("v_boundary_examples");
    expect(body).toContain("v_component_names");
    expect(body).toContain("v_required_input_names");
    expect(body).toContain("v_parameter_names");
    expect(body).toContain("v_example_names");
    expect(identifierBody).toContain("'amount'");
    expect(body).toContain(
      "v_scope <> 'payable' and v_target_type <> 'project'",
    );
    expect(offsetDatetimeBody).toContain("([01][0-9]|2[0-3])");
    expect(offsetDatetimeBody).toContain("[0-5][0-9]:[0-5][0-9]");
    expect(offsetDatetimeBody).toContain("v_calendar_date :=");
    expect(offsetDatetimeBody).toContain("pg_catalog.to_char(");
    expect(selfChecks).toContain("invalid_contract_hour_24");
    expect(selfChecks).toContain("invalid_contract_feb_30");
    expect(tableCheck).toContain(
      "public.settlement_ai_business_contract_is_valid(business_contract)",
    );
    expect(
      createDraft.indexOf(
        "public.settlement_ai_business_contract_is_valid(p_business_contract)",
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      createDraft.indexOf(
        "public.settlement_ai_business_contract_is_valid(p_business_contract)",
      ),
    ).toBeLessThan(createDraft.indexOf("insert into public.ai_settlement_rule_drafts"));
  });

  it("keeps every draft JSON value readable by the repository schemas", () => {
    const validatorNames = [
      "settlement_ai_turn_trace_json_is_valid",
      "settlement_ai_unresolved_ambiguities_is_valid",
      "settlement_ai_response_is_valid",
      "settlement_ai_normalized_ast_is_valid",
      "settlement_ai_generated_formula_is_valid",
      "settlement_ai_generated_test_cases_is_valid",
      "settlement_ai_safety_flags_is_valid",
      "settlement_ai_draft_formula_state_is_valid",
      "settlement_ai_draft_payload_is_valid",
    ];
    for (const validatorName of validatorNames) {
      const validator = extractSettlementAiFunction(validatorName);
      expect(normalizeSql(validator.header)).toContain("returns boolean");
      expect(normalizeSql(validator.header)).toContain(
        "set search_path = pg_catalog, public",
      );
      expect(normalizeSql(validator.body)).not.toMatch(
        /^begin return true; end;$/u,
      );
      expect(normalizedSettlementAiMigration).toContain(
        `revoke all on function public.${validatorName}(`,
      );
      expect(normalizedSettlementAiMigration).not.toMatch(
        new RegExp(`grant execute on function public\\.${validatorName}\\(`, "u"),
      );
    }

    const ambiguities = settlementAiFunctionBody(
      "settlement_ai_unresolved_ambiguities_is_valid",
    );
    expect(ambiguities).toContain("pg_catalog.jsonb_array_length(p_value) > 100");
    expect(ambiguities).toContain("array['code', 'question', 'required']::text[]");
    expect(ambiguities).toContain("v_item -> 'code') <> 'string'");
    expect(ambiguities).toContain("not between 1 and 120");
    expect(ambiguities).toContain("v_item -> 'question') <> 'string'");
    expect(ambiguities).toContain("not between 1 and 4000");
    expect(ambiguities).toContain("v_item -> 'required') <> 'boolean'");

    const aiResponse = settlementAiFunctionBody(
      "settlement_ai_response_is_valid",
    );
    expect(aiResponse).toContain(
      "array['content', 'finishreason', 'providerrequestid']::text[]",
    );
    expect(aiResponse).toContain(
      "'stop', 'length', 'content_filter', 'tool_call'",
    );
    expect(aiResponse).toContain("between 1 and 500");
    expect(aiResponse).toContain(
      "pg_catalog.char_length(p_value ->> 'content') > 4000",
    );
    expect(aiResponse).toContain(
      "nullif(pg_catalog.btrim(p_value ->> 'content'), '') is null",
    );

    const normalizedAst = settlementAiFunctionBody(
      "settlement_ai_normalized_ast_is_valid",
    );
    for (const kind of [
      "literal",
      "identifier",
      "unary",
      "binary",
      "call",
      "array",
      "object",
    ]) {
      expect(normalizedAst).toContain(`v_kind = '${kind}'`);
    }
    expect(normalizedAst).toContain(
      "public.settlement_ai_normalized_ast_is_valid",
    );
    expect(normalizedAst).toContain("public.settlement_ai_finite_number_json");

    const generatedFormula = settlementAiFunctionBody(
      "settlement_ai_generated_formula_is_valid",
    );
    expect(generatedFormula).toContain(
      "array['expression', 'normalizedast']::text[]",
    );
    expect(generatedFormula).toContain(
      "public.settlement_ai_normalized_ast_is_valid",
    );

    const generatedTests = settlementAiFunctionBody(
      "settlement_ai_generated_test_cases_is_valid",
    );
    expect(generatedTests).toMatch(
      /pg_catalog\.jsonb_array_length\(p_value\) not between 1 and 200/u,
    );
    expect(generatedTests).toContain(
      "array['name', 'inputs', 'expectedresult']::text[]",
    );
    expect(generatedTests).toContain(
      "public.settlement_ai_plain_identifier_is_valid",
    );
    expect(generatedTests).toContain(
      "public.settlement_ai_typed_value_is_valid",
    );

    const safetyFlags = settlementAiFunctionBody(
      "settlement_ai_safety_flags_is_valid",
    );
    expect(safetyFlags).toContain("pg_catalog.jsonb_array_length(p_value) > 100");
    expect(safetyFlags).toContain("array['code', 'severity', 'message']::text[]");
    expect(safetyFlags).toContain("'info', 'warning', 'block'");

    const payloadCheck = settlementAiCheckDefinition(
      "ai_settlement_rule_drafts",
      "ai_settlement_rule_drafts_payload_valid",
    );
    const createDraft = settlementAiFunctionBody(
      "create_ai_settlement_rule_draft",
    );
    expect(payloadCheck).toContain(
      "public.settlement_ai_draft_payload_is_valid(",
    );
    const payloadPrecheck = createDraft.indexOf(
      "public.settlement_ai_draft_payload_is_valid(",
    );
    expect(payloadPrecheck).toBeGreaterThanOrEqual(0);
    expect(payloadPrecheck).toBeLessThan(
      createDraft.indexOf("insert into public.ai_settlement_rule_drafts"),
    );
  });

  it("bounds every JSON payload before recursive validation", () => {
    const budget = extractSettlementAiFunction(
      "settlement_ai_json_within_budget",
    );
    const header = normalizeSql(budget.header);
    const body = normalizeSql(budget.body);
    expect(header).toContain("language plpgsql");
    expect(header).toContain("immutable");
    expect(header).toContain("set search_path = pg_catalog, public");
    expect(body).toContain("pg_catalog.pg_column_size(p_value) > 262144");
    expect(body).toContain("pg_catalog.pg_column_size(v_node) > 65536");
    expect(body).toContain("v_node_count > 300");
    expect(body).toContain("v_depth > 20");
    expect(body).toContain("v_item_count > 200");
    expect(body).toContain("pg_catalog.octet_length(v_node #>> '{}') > 16384");
    expect(body).toContain("pg_catalog.octet_length(v_key) > 256");
    expect(body).not.toContain("with recursive");

    const draftPayload = settlementAiFunctionBody(
      "settlement_ai_draft_payload_is_valid",
    );
    const simulationSummary = settlementAiFunctionBody(
      "settlement_ai_simulation_summary_is_valid",
    );
    expect(draftPayload).toMatch(
      /public\.settlement_ai_json_within_budget\(\s*pg_catalog\.jsonb_build_array\(/u,
    );
    expect(simulationSummary).toMatch(
      /public\.settlement_ai_json_within_budget\(\s*pg_catalog\.jsonb_build_array\(/u,
    );
    for (const value of [
      "p_turn_trace",
      "p_business_contract",
      "p_unresolved_ambiguities",
      "p_ai_response",
      "p_generated_formula",
      "p_generated_test_cases",
      "p_safety_flags",
    ]) {
      expect(draftPayload).toContain(
        `public.settlement_ai_json_within_budget(${value})`,
      );
    }
    for (const value of [
      "p_sample_source",
      "p_sample_selection",
      "p_coverage",
      "p_scenarios",
      "p_historical_totals",
      "p_deltas",
      "p_largest_changes",
      "p_warnings",
    ]) {
      expect(simulationSummary).toContain(
        `public.settlement_ai_json_within_budget(${value})`,
      );
    }
    expect(normalizedSettlementAiMigration).toContain(
      "revoke all on function public.settlement_ai_json_within_budget(jsonb)",
    );
  });

  it("fingerprints the immutable initial draft request including status", () => {
    const draft = settlementAiTableDefinition("ai_settlement_rule_drafts");
    const createDraft = settlementAiFunctionBody(
      "create_ai_settlement_rule_draft",
    );
    expect(draft).toContain("request_fingerprint text not null");
    expect(draft).toContain(
      "request_fingerprint ~ '^[0-9a-f]{64}$'",
    );
    expect(createDraft).toContain("v_request_fingerprint text");
    expect(createDraft).toContain("extensions.digest(");
    expect(createDraft).toContain("'status', p_status");
    for (const field of [
      "p_organization_id",
      "p_project_id",
      "p_conversation_id",
      "p_idempotency_key",
      "p_prompt_text",
      "p_turn_trace",
      "p_business_contract",
      "p_unresolved_ambiguities",
      "p_variable_catalog_version",
      "p_ai_response",
      "p_generated_formula",
      "p_generated_explanation",
      "p_generated_test_cases",
      "p_model",
      "p_safety_flags",
      "p_contract_hash",
      "p_formula_hash",
      "p_parameter_hash",
    ]) {
      expect(createDraft).toContain(field);
    }
    expect(createDraft).toContain(
      "v_existing.request_fingerprint <> v_request_fingerprint",
    );
    expect(createDraft).toMatch(
      /insert into public\.ai_settlement_rule_drafts \([^)]*request_fingerprint/iu,
    );
    expect(createDraft).not.toContain("v_existing.status <> p_status");
  });

  it("validates every simulation summary container before table or RPC writes", () => {
    const validator = extractSettlementAiFunction(
      "settlement_ai_simulation_summary_is_valid",
    );
    const header = normalizeSql(validator.header);
    const body = normalizeSql(validator.body);
    const safetyBody = settlementAiFunctionBody(
      "settlement_ai_simulation_json_is_safe",
    );
    const tableCheck = settlementAiCheckDefinition(
      "settlement_formula_simulations",
      "settlement_formula_simulations_summary_valid",
    );
    const createSimulation = settlementAiFunctionBody(
      "create_settlement_formula_simulation",
    );

    expect(header).toContain("returns boolean");
    expect(header).toContain("language plpgsql");
    expect(header).toContain("immutable");
    expect(header).toContain("set search_path = pg_catalog, public");
    expect(body).not.toMatch(/^begin return true; end;$/u);
    expect(body.match(/return false/gu)?.length ?? 0).toBeGreaterThan(5);
    expect(body).toContain("public.settlement_ai_simulation_json_is_safe");
    expect(body).toContain("public.settlement_ai_json_has_exact_keys");
    expect(body).toContain("public.settlement_ai_safe_integer_json");
    expect(body).toContain("public.settlement_ai_decimal_is_bigint");
    expect(body).toMatch(
      /from pg_catalog\.jsonb_array_elements\(\s*p_sample_selection -> 'criteria'\s*\) as criteria\(value\)/u,
    );
    expect(body).toContain("pg_catalog.jsonb_typeof(v_item) <> 'string'");
    expect(body).toMatch(
      /pg_catalog\.jsonb_array_length\(p_scenarios\) between 1 and 200/u,
    );
    expect(body).toMatch(
      /pg_catalog\.jsonb_array_length\(p_largest_changes\) <= 100/u,
    );
    expect(body).toMatch(
      /pg_catalog\.jsonb_array_length\(p_warnings\) <= 100/u,
    );
    expect(safetyBody).toContain("'reportid'");
    expect(safetyBody).toContain("'projectid'");
    expect(safetyBody).toContain("'streamerid'");
    expect(safetyBody).toContain("'internalmargin'");
    expect(safetyBody).toContain("'amountcents'");
    for (const forbiddenValue of [
      "'projectid'",
      "'reportid'",
      "'amountcents'",
      "'streamer'",
      "'streameramount'",
      "'tax'",
      "'rawpayload'",
    ]) {
      expect(body).toContain(forbiddenValue);
    }
    expect(tableCheck).toContain(
      "public.settlement_ai_simulation_summary_is_valid(",
    );
    const validatorCall = createSimulation.indexOf(
      "public.settlement_ai_simulation_summary_is_valid(",
    );
    expect(validatorCall).toBeGreaterThanOrEqual(0);
    expect(validatorCall).toBeLessThan(
      createSimulation.indexOf(
        "insert into public.settlement_formula_simulations",
      ),
    );
  });

  it("ships executable negative validator self-checks and exact read policies", () => {
    const selfChecks = settlementAiSelfCheckBlock();
    expect(
      businessRuleContractSchema.safeParse(
        settlementAiCanonicalBusinessContract(),
      ).success,
    ).toBe(true);
    for (const fixture of [
      "invalid_contract_extra_key",
      "invalid_contract_empty_components",
      "invalid_contract_empty_examples",
      "invalid_contract_target_scope",
      "invalid_contract_timezone",
      "invalid_contract_hour_24",
      "invalid_contract_feb_30",
      "invalid_trace_accepted",
      "invalid_ambiguity_code_type",
      "invalid_ambiguity_question_type",
      "invalid_ambiguity_required_type",
      "invalid_selection_criteria_object",
      "invalid_selection_raw_rows",
      "invalid_selection_project_id",
      "invalid_selection_amount_cents",
    ]) {
      expect(selfChecks).toContain(fixture);
    }
    expect(selfChecks).toContain(
      "if not public.settlement_ai_business_contract_is_valid(v_valid_contract)",
    );
    expect(selfChecks).toContain(
      "if not public.settlement_ai_simulation_summary_is_valid(",
    );
    expect(selfChecks.match(/raise exception/gu)?.length ?? 0).toBeGreaterThan(
      14,
    );

    for (const insertTarget of [
      "auth.users",
      "public.profiles",
      "public.organizations",
      "public.organization_members",
      "public.projects",
      "public.ai_conversations",
      "public.ai_chat_messages",
      "public.ai_chat_turns",
    ]) {
      expect(selfChecks).toContain(`insert into ${insertTarget}`);
    }
    expect(selfChecks).toMatch(
      /pg_catalog\.set_config\(\s*'request\.jwt\.claim\.sub'/u,
    );
    expect(
      selfChecks.match(/public\.create_ai_settlement_rule_draft\(/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(5);
    expect(
      selfChecks.match(/public\.create_settlement_formula_simulation\(/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    for (const behaviorAssertion of [
      "actual_draft_shape_invalid",
      "actual_revision_sequence_invalid",
      "forged_trace_rpc_accepted",
      "malformed_ambiguity_rpc_accepted",
      "invalid_datetime_rpc_accepted",
      "phase1_rule_version_rpc_accepted",
      "oversized_warning_rpc_accepted",
      "idempotency_status_conflict_missing",
      "idempotent_superseded_message_replay_invalid",
      "idempotent_lifecycle_replay_invalid",
      "actual_clarifying_no_formula_invalid",
      "clarifying_placeholder_rpc_accepted",
      "actual_contract_ready_formula_invalid",
      "actual_simulation_shape_invalid",
      "raw_criteria_rpc_accepted",
      "settlement_ai_rpc_fixture_rollback",
      "settlement_ai_rpc_fixture_cleanup_failed",
    ]) {
      expect(selfChecks).toContain(behaviorAssertion);
    }
    expect(selfChecks).toContain("when others then");
    expect(selfChecks).toContain("sqlerrm");
    expect(selfChecks).toMatch(
      /update public\.ai_chat_messages\s+set status = 'superseded'\s+where id = v_assistant_message_id/u,
    );

    for (const policyName of [
      "ai_settlement_rule_drafts_mcn_project_read",
      "settlement_formula_simulations_mcn_project_read",
    ]) {
      const policy = settlementAiPolicyDefinition(policyName);
      expect(policy).toContain("for select using (");
      expect(policy).toContain("auth.uid() is not null");
      expect(policy).toContain("public.is_org_member(organization_id)");
      expect(policy).toContain("public.is_mcn_staff(organization_id)");
      expect(policy).toContain("public.can_access_project(project_id)");
      expect(policy).not.toMatch(/for (insert|update|delete|all)/u);
    }
  });
});
