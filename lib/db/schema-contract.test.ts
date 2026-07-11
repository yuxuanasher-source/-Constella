import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

function settlementAiTableDefinition(table: string): string {
  const match = normalizedSettlementAiMigration.match(
    new RegExp(`create table public\\.${table} \\((.*?)\\);`, "u"),
  );
  return match?.[1] ?? "";
}

function settlementAiFunctionDefinition(fn: string): string {
  const match = normalizedSettlementAiMigration.match(
    new RegExp(
      `create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`,
      "u",
    ),
  );
  return match?.[0] ?? "";
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
      "generated_formula jsonb not null",
      "generated_explanation text not null",
      "generated_test_cases jsonb not null",
      "model text not null",
      "safety_flags jsonb not null",
      "contract_hash text not null",
      "formula_hash text not null",
      "parameter_hash text not null",
      "status text not null",
      "revision_number integer not null",
      "idempotency_key text not null",
      "created_by uuid not null",
      "created_at timestamptz not null",
      "supersedes_draft_id uuid",
      "superseded_by_draft_id uuid",
      "superseded_at timestamptz",
    ]) {
      expect(draft).toContain(column);
    }

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
    expect(simulation).toContain(
      "constraint settlement_formula_simulations_exactly_one_owner check (((rule_version_id is not null)::integer + (ai_draft_id is not null)::integer = 1))",
    );
    expect(simulation).toContain(
      "constraint settlement_formula_simulations_draft_scope_fkey foreign key (ai_draft_id, organization_id, project_id) references public.ai_settlement_rule_drafts(id, organization_id, project_id)",
    );
    expect(simulation).not.toMatch(/foreign key \(rule_version_id/u);
    expect(simulation).not.toMatch(/rule_version_id uuid references/u);
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
});
