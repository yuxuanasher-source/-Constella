import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createConversationService,
  type ConversationPersistence,
} from "../../features/ai/conversation-service";
import type {
  CreatedConversationTurn,
  StoredConversationTurn,
} from "../../features/ai/conversation-repository";
import { businessRuleContractSchema } from "../../features/settlements/custom-rule-contract";
import { SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES } from "../../features/settlements/custom-rule-repository";

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
const settlementRuntimeMigrationName =
  "20260711115000_custom_settlement_runtime_snapshot.sql";
const settlementRuntimeMigration = readdirSync(migrationsDir).includes(
  settlementRuntimeMigrationName,
)
  ? readFileSync(join(migrationsDir, settlementRuntimeMigrationName), "utf8")
  : "";
const normalizedSettlementRuntimeMigration = normalizeSql(
  settlementRuntimeMigration,
);
const settlementRuntimeHardeningMigrationName =
  "20260711115600_custom_settlement_runtime_snapshot_hardening.sql";
const settlementRuntimeHardeningMigration = readdirSync(migrationsDir).includes(
  settlementRuntimeHardeningMigrationName,
)
  ? readFileSync(
      join(migrationsDir, settlementRuntimeHardeningMigrationName),
      "utf8",
    )
  : "";
const normalizedSettlementRuntimeHardeningMigration = normalizeSql(
  settlementRuntimeHardeningMigration,
);
const settlementAuthoringRoleHardeningMigrationName =
  "20260711115700_custom_settlement_authoring_role_hardening.sql";
const settlementAuthoringRoleHardeningMigration = readdirSync(
  migrationsDir,
).includes(settlementAuthoringRoleHardeningMigrationName)
  ? readFileSync(
      join(migrationsDir, settlementAuthoringRoleHardeningMigrationName),
      "utf8",
    )
  : "";
const normalizedSettlementAuthoringRoleHardeningMigration = normalizeSql(
  settlementAuthoringRoleHardeningMigration,
);
const settlementSimulationSummaryV2MigrationName =
  "20260711115800_custom_settlement_simulation_summary_v2.sql";
const settlementSimulationSummaryV2Migration = readdirSync(
  migrationsDir,
).includes(settlementSimulationSummaryV2MigrationName)
  ? readFileSync(
      join(migrationsDir, settlementSimulationSummaryV2MigrationName),
      "utf8",
    )
  : "";
const normalizedSettlementSimulationSummaryV2Migration = normalizeSql(
  settlementSimulationSummaryV2Migration,
);
const settlementGovernanceMigrationName =
  "20260711120000_custom_settlement_rule_governance.sql";
const settlementGovernanceMigration = readdirSync(migrationsDir).includes(
  settlementGovernanceMigrationName,
)
  ? readFileSync(join(migrationsDir, settlementGovernanceMigrationName), "utf8")
  : "";
const normalizedSettlementGovernanceMigration = normalizeSql(
  settlementGovernanceMigration,
);

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/gu, " ").trim();
}

function settlementRuntimeTableDefinition(table: string): string {
  return normalizeSql(
    extractBalancedSql(
      settlementRuntimeMigration,
      `create table public.${table}`,
    ).inner,
  );
}

function extractSettlementRuntimeFunction(fn: string): {
  definition: string;
  header: string;
  body: string;
} {
  const source =
    fn === "read_custom_settlement_evidence_snapshot"
      ? settlementRuntimeHardeningMigration
      : settlementRuntimeMigration;
  const marker = `create or replace function public.${fn}`;
  const start = source.toLowerCase().indexOf(marker);
  expect(start, `missing Task8 SQL function: ${fn}`).toBeGreaterThanOrEqual(0);
  const bodyMarker = /\bas\s+\$\$/giu;
  bodyMarker.lastIndex = start;
  const bodyStartMatch = bodyMarker.exec(source);
  expect(bodyStartMatch, `missing Task8 function body: ${fn}`).not.toBeNull();
  const bodyStart = bodyStartMatch?.index ?? -1;
  const bodyContentStart = bodyStart + (bodyStartMatch?.[0].length ?? 0);
  const bodyEnd = source.indexOf("$$;", bodyContentStart);
  expect(bodyEnd, `missing Task8 function terminator: ${fn}`).toBeGreaterThan(
    bodyContentStart,
  );
  return {
    definition: source.slice(start, bodyEnd + 3),
    header: source.slice(start, bodyStart),
    body: source.slice(bodyContentStart, bodyEnd),
  };
}

function settlementRuntimeFunctionDefinition(fn: string): string {
  return normalizeSql(extractSettlementRuntimeFunction(fn).definition);
}

function settlementRuntimeFunctionBody(fn: string): string {
  return normalizeSql(extractSettlementRuntimeFunction(fn).body);
}

function settlementRuntimeSelfCheckBlock(): string {
  const marker = "-- custom_settlement_runtime_self_checks";
  const start = settlementRuntimeHardeningMigration.indexOf(marker);
  expect(
    start,
    "missing Task8 runtime self-check marker",
  ).toBeGreaterThanOrEqual(0);
  const blockStart = settlementRuntimeHardeningMigration.indexOf(
    "do $$",
    start,
  );
  const blockEnd = settlementRuntimeHardeningMigration.indexOf(
    "$$;",
    blockStart,
  );
  expect(blockStart).toBeGreaterThan(start);
  expect(blockEnd).toBeGreaterThan(blockStart);
  return normalizeSql(
    settlementRuntimeHardeningMigration.slice(blockStart, blockEnd + 3),
  );
}

function extractSettlementAuthoringRoleHardeningFunction(fn: string): {
  definition: string;
  body: string;
} {
  const marker = `create or replace function public.${fn}`;
  const start = settlementAuthoringRoleHardeningMigration
    .toLowerCase()
    .indexOf(marker);
  expect(
    start,
    `missing authoring role hardening function: ${fn}`,
  ).toBeGreaterThanOrEqual(0);
  const bodyMarker = /\bas\s+\$\$/giu;
  bodyMarker.lastIndex = start;
  const bodyStartMatch = bodyMarker.exec(
    settlementAuthoringRoleHardeningMigration,
  );
  expect(
    bodyStartMatch,
    `missing authoring role hardening body: ${fn}`,
  ).not.toBeNull();
  const bodyStart = bodyStartMatch?.index ?? -1;
  const bodyContentStart = bodyStart + (bodyStartMatch?.[0].length ?? 0);
  const bodyEnd = settlementAuthoringRoleHardeningMigration.indexOf(
    "$$;",
    bodyContentStart,
  );
  expect(
    bodyEnd,
    `missing authoring role hardening terminator: ${fn}`,
  ).toBeGreaterThan(bodyContentStart);
  return {
    definition: normalizeSql(
      settlementAuthoringRoleHardeningMigration.slice(start, bodyEnd + 3),
    ),
    body: normalizeSql(
      settlementAuthoringRoleHardeningMigration.slice(
        bodyContentStart,
        bodyEnd,
      ),
    ),
  };
}

function gitBlobOid(content: string): string {
  const size = Buffer.byteLength(content, "utf8");
  return createHash("sha1")
    .update(`blob ${size}\0`, "utf8")
    .update(content, "utf8")
    .digest("hex");
}

function extractBalancedSql(
  sql: string,
  marker: string,
): { full: string; inner: string } {
  const normalizedSql = sql.toLowerCase();
  const markerIndex = normalizedSql.indexOf(marker.toLowerCase());
  expect(markerIndex, `missing SQL marker: ${marker}`).toBeGreaterThanOrEqual(
    0,
  );
  const openIndex = sql.indexOf("(", markerIndex + marker.length);
  expect(
    openIndex,
    `missing opening parenthesis after: ${marker}`,
  ).toBeGreaterThan(markerIndex);

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
    extractBalancedSql(settlementAiMigration, `create table public.${table}`)
      .inner,
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

type SettlementAiRowLock = {
  relation: string;
  mode: "key share" | "update";
};

function settlementAiRowLocks(fn: string): SettlementAiRowLock[] {
  return extractSettlementAiFunction(fn)
    .body.split(";")
    .flatMap((statement) => {
      const mode = statement
        .match(/\bfor\s+(key\s+share|update)\b/iu)?.[1]
        ?.toLowerCase()
        .replace(/\s+/gu, " ");
      if (mode !== "key share" && mode !== "update") return [];
      const relation = statement.match(/\bfrom\s+public\.([a-z_]+)/iu)?.[1];
      expect(relation, `missing locked relation in ${fn}`).toBeDefined();
      return [{ relation: relation ?? "", mode }];
    });
}

function settlementAiForeignKeyParents(table: string): string[] {
  return Array.from(
    settlementAiTableDefinition(table).matchAll(
      /\breferences public\.([a-z_]+)/gu,
    ),
    (match) => match[1] ?? "",
  );
}

function settlementAiAuthenticatedAuthoringRpcNames(): string[] {
  return Array.from(
    normalizedSettlementAiMigration.matchAll(
      /grant execute on function public\.((?:create_ai_settlement_rule_draft|create_settlement_formula_simulation|finalize_settlement_ai_(?:draft|simulation|failed)_turn))\(/gu,
    ),
    (match) => match[1] ?? "",
  );
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
    extractBalancedSql(tableDefinition, `constraint ${constraint} check`).full,
  );
}

function settlementAiSelfCheckSource(): string {
  const marker = "-- settlement_ai_validator_self_checks";
  const start = settlementAiMigration.indexOf(marker);
  expect(start, "missing validator self-check marker").toBeGreaterThanOrEqual(
    0,
  );
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

function settlementGovernanceTableDefinition(table: string): string {
  return normalizeSql(
    extractBalancedSql(
      settlementGovernanceMigration,
      `create table public.${table}`,
    ).inner,
  );
}

function extractSettlementGovernanceFunction(fn: string): {
  definition: string;
  body: string;
} {
  const marker = `create or replace function public.${fn}`;
  const start = settlementGovernanceMigration.toLowerCase().indexOf(marker);
  expect(
    start,
    `missing Phase 2 governance function: ${fn}`,
  ).toBeGreaterThanOrEqual(0);
  const bodyMarker = /\bas\s+\$\$/giu;
  bodyMarker.lastIndex = start;
  const bodyStartMatch = bodyMarker.exec(settlementGovernanceMigration);
  expect(
    bodyStartMatch,
    `missing Phase 2 governance body: ${fn}`,
  ).not.toBeNull();
  const bodyStart = bodyStartMatch?.index ?? -1;
  const bodyContentStart = bodyStart + (bodyStartMatch?.[0].length ?? 0);
  const bodyEnd = settlementGovernanceMigration.indexOf(
    "$$;",
    bodyContentStart,
  );
  expect(
    bodyEnd,
    `missing Phase 2 governance terminator: ${fn}`,
  ).toBeGreaterThan(bodyContentStart);
  return {
    definition: normalizeSql(
      settlementGovernanceMigration.slice(start, bodyEnd + 3),
    ),
    body: normalizeSql(
      settlementGovernanceMigration.slice(bodyContentStart, bodyEnd),
    ),
  };
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

    expect(allMigrations).toContain(
      "ai_chat_messages_conversation_sequence_key",
    );
    expect(allMigrations).toContain("ai_chat_turns_owner_idempotency_key");
    expect(allMigrations).toContain(
      "ai_chat_turns_one_active_per_conversation",
    );
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
    expect(createDraft).toContain("coalesce(max(d.revision_number), 0) + 1");
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

  it("atomically finalizes Xingyao turns before persisting settlement domain rows", () => {
    const lockTurn = settlementAiFunctionDefinition(
      "settlement_ai_lock_atomic_draft_turn",
    );
    const finalizeDraft = settlementAiFunctionDefinition(
      "finalize_settlement_ai_draft_turn",
    );
    const finalizeSimulation = settlementAiFunctionDefinition(
      "finalize_settlement_ai_simulation_turn",
    );
    const finalizeFailed = settlementAiFunctionDefinition(
      "finalize_settlement_ai_failed_turn",
    );

    for (const fn of [
      lockTurn,
      finalizeDraft,
      finalizeSimulation,
      finalizeFailed,
    ]) {
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = pg_catalog, public");
    }
    for (const fn of [finalizeDraft, finalizeSimulation, finalizeFailed]) {
      expect(fn).toContain("public.settlement_ai_lock_atomic_draft_turn");
    }
    expect(lockTurn).toContain("auth.uid()");
    expect(lockTurn).toContain("public.is_org_member");
    expect(lockTurn).toContain("public.is_mcn_staff");
    expect(lockTurn).toContain("public.can_access_project");
    const conversationLock = lockTurn.indexOf("from public.ai_conversations");
    const turnLock = lockTurn.indexOf("from public.ai_chat_turns");
    expect(conversationLock).toBeGreaterThanOrEqual(0);
    expect(turnLock).toBeGreaterThan(conversationLock);
    expect(lockTurn).toContain("for update");

    expect(finalizeDraft).toContain("v_turn.status = 'completed'");
    expect(finalizeDraft).toContain("v_turn.status <> 'validating'");
    expect(finalizeDraft).toContain(
      "settlement_ai_atomic_completed_without_draft",
    );
    expect(finalizeDraft).toContain(
      "settlement_ai_atomic_completion_replay_conflict",
    );
    expect(finalizeDraft).toContain(
      "from public.ai_chat_messages as terminal_message",
    );
    expect(finalizeDraft).toContain(
      "terminal_message.metadata is not distinct from",
    );
    expect(finalizeDraft).toContain("v_turn.provider_name is distinct from");
    expect(finalizeDraft).toContain("public.finish_ai_chat_turn(");
    expect(finalizeDraft).toContain("public.create_ai_settlement_rule_draft(");
    expect(finalizeDraft.indexOf("public.finish_ai_chat_turn(")).toBeLessThan(
      finalizeDraft.indexOf("public.create_ai_settlement_rule_draft("),
    );

    expect(finalizeSimulation).toContain("v_turn.status = 'completed'");
    expect(finalizeSimulation).toContain(
      "settlement_ai_atomic_completed_without_simulation",
    );
    expect(finalizeSimulation).toContain("public.finish_ai_chat_turn(");
    expect(finalizeSimulation).toContain(
      "public.create_ai_settlement_rule_draft(",
    );
    expect(finalizeSimulation).toContain(
      "public.create_settlement_formula_simulation(",
    );
    expect(
      finalizeSimulation.indexOf("public.finish_ai_chat_turn("),
    ).toBeLessThan(
      finalizeSimulation.indexOf("public.create_ai_settlement_rule_draft("),
    );
    expect(
      finalizeSimulation.indexOf("public.create_ai_settlement_rule_draft("),
    ).toBeLessThan(
      finalizeSimulation.indexOf(
        "public.create_settlement_formula_simulation(",
      ),
    );

    expect(finalizeFailed).toContain("v_turn.status = 'failed'");
    expect(finalizeFailed).toContain("v_turn.status <> 'validating'");
    expect(finalizeFailed).toContain("public.finish_ai_chat_turn(");
    expect(finalizeFailed).toContain("false,");
    expect(finalizeFailed).toContain(
      "public.settlement_ai_failure_semantics_are_valid( p_error_code, p_error_summary, p_retryable )",
    );
    expect(finalizeFailed).toContain(
      "v_turn.error_code is distinct from p_error_code",
    );
    expect(finalizeFailed).toContain(
      "v_turn.error_summary is distinct from p_error_summary",
    );
    expect(finalizeFailed).toContain(
      "v_turn.retryable is distinct from p_retryable",
    );
    expect(finalizeFailed).toMatch(
      /false, p_completion ->> 'content', pg_catalog\.btrim\(p_completion ->> 'providername'\), \(p_completion ->> 'aiinvocationid'\)::uuid, p_error_code, p_error_summary, p_retryable, p_completion -> 'metadata'/u,
    );
    expect(finalizeFailed.indexOf("public.finish_ai_chat_turn(")).toBeLessThan(
      finalizeFailed.indexOf("public.create_ai_settlement_rule_draft("),
    );
  });

  it("allowlists bounded settlement failure semantics and keeps the helper private", () => {
    const validator = extractSettlementAiFunction(
      "settlement_ai_failure_semantics_are_valid",
    );
    const header = normalizeSql(validator.header);
    const body = normalizeSql(validator.body);

    expect(header).toContain("p_error_code text");
    expect(header).toContain("p_error_summary text");
    expect(header).toContain("p_retryable boolean");
    expect(header).toContain("returns boolean");
    expect(header).toContain("immutable");
    expect(header).toContain("set search_path = pg_catalog, public");
    expect(body).toContain("pg_catalog.octet_length(p_error_code) <= 64");
    expect(body).toContain("pg_catalog.octet_length(p_error_summary) <= 120");
    expect(body).toContain("'settlement_ai_provider_failed'");
    expect(body).toContain(
      "'settlement ai provider is temporarily unavailable.'",
    );
    expect(body).toContain("'settlement_ai_formula_invalid'");
    expect(body).toContain("'settlement ai formula did not pass validation.'");
    const allowedFailures = Object.entries(
      SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES,
    );
    expect(body.match(/\bwhen '/gu)?.length ?? 0).toBe(allowedFailures.length);
    for (const [errorCode, errorSummary] of allowedFailures) {
      expect(
        new TextEncoder().encode(errorCode).byteLength,
      ).toBeLessThanOrEqual(64);
      expect(
        new TextEncoder().encode(errorSummary).byteLength,
      ).toBeLessThanOrEqual(120);
      expect(body).toContain(`when '${errorCode.toLowerCase()}' then`);
      expect(body).toContain(
        `p_error_summary = '${errorSummary.toLowerCase()}'`,
      );
    }
    expect(body).not.toMatch(/^select true;$/u);
    expect(normalizedSettlementAiMigration).toMatch(
      /revoke all on function public\.settlement_ai_failure_semantics_are_valid\(\s*text, text, boolean\s*\)/u,
    );
    expect(normalizedSettlementAiMigration).not.toMatch(
      /grant execute on function public\.settlement_ai_failure_semantics_are_valid/u,
    );
    expect(normalizedSettlementAiMigration).toMatch(
      /grant execute on function public\.finalize_settlement_ai_failed_turn\(\s*jsonb, jsonb, text, text, boolean\s*\) to authenticated;/u,
    );
  });

  it("enforces retry eligibility in ConversationService over lower-level persistence", async () => {
    // The generic RPC stays lower-level; application retry eligibility lives here.
    const actor = { organizationId: "org-1", userId: "user-1" };
    const createStore = (retryable: boolean) => {
      const source: StoredConversationTurn = {
        id: "source-turn",
        conversationId: "conversation-1",
        userMessageId: "user-message-1",
        assistantMessageId: "failed-message-1",
        mode: "deep",
        status: "failed",
        attempt: 1,
        contextSnapshot: null,
        retryOfTurnId: null,
        regenerateOfTurnId: null,
        providerName: "openai",
        errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
        errorSummary: "Settlement AI provider is temporarily unavailable.",
        retryable,
      };
      const state = { createAttempts: 0, createdSuccessors: 0 };
      let successor: CreatedConversationTurn | null = null;
      const persistence: ConversationPersistence = {
        createConversation: async () => null,
        listConversations: async () => [],
        getConversation: async () => null,
        listMessages: async () => [],
        listTurns: async () => [source],
        getTurn: async () => source,
        createTurn: async (input) => {
          state.createAttempts += 1;
          if (input.kind !== "retry" || input.sourceTurnId !== source.id) {
            return null;
          }
          if (successor) return { ...successor, duplicate: true };
          state.createdSuccessors += 1;
          successor = {
            conversationId: source.conversationId,
            turnId: "retry-turn-1",
            userMessageId: source.userMessageId,
            assistantMessageId: "retry-assistant-message-1",
            status: "accepted",
            attempt: 2,
            duplicate: false,
          };
          return successor;
        },
        transitionTurn: async () => true,
        completeTurn: async () => true,
        failTurn: async () => true,
        renewLease: async () => true,
      };
      return { persistence, state };
    };

    const retryable = createStore(true);
    const retryableService = createConversationService(retryable.persistence);
    const first = await retryableService.retryTurn(actor, "source-turn", {
      clientRequestId: "retry-request-1",
    });
    const replay = await retryableService.retryTurn(actor, "source-turn", {
      clientRequestId: "retry-request-1",
    });
    expect(first).toMatchObject({ turnId: "retry-turn-1", duplicate: false });
    expect(replay).toMatchObject({ turnId: "retry-turn-1", duplicate: true });
    expect(retryable.state).toEqual({
      createAttempts: 2,
      createdSuccessors: 1,
    });

    const nonRetryable = createStore(false);
    const nonRetryableService = createConversationService(
      nonRetryable.persistence,
    );
    await expect(
      nonRetryableService.retryTurn(actor, "source-turn", {
        clientRequestId: "retry-request-2",
      }),
    ).rejects.toMatchObject({ code: "turn_not_retryable" });
    expect(nonRetryable.state).toEqual({
      createAttempts: 0,
      createdSuccessors: 0,
    });
  });

  it("derives one complete parent-first lock graph from authoring foreign keys", () => {
    const parentHelper = settlementAiFunctionDefinition(
      "settlement_ai_lock_authoring_parents",
    );
    expect(parentHelper).toContain("security definer");
    expect(parentHelper).toContain("set search_path = pg_catalog, public");
    expect(
      settlementAiRowLocks("settlement_ai_lock_authoring_parents"),
    ).toEqual([
      { relation: "organizations", mode: "key share" },
      { relation: "profiles", mode: "key share" },
      { relation: "projects", mode: "update" },
    ]);
    expect(
      Array.from(
        new Set(settlementAiForeignKeyParents("ai_settlement_rule_drafts")),
      ),
    ).toEqual([
      "organizations",
      "profiles",
      "projects",
      "ai_conversations",
      "ai_settlement_rule_drafts",
    ]);
    expect(
      Array.from(
        new Set(
          settlementAiForeignKeyParents("settlement_formula_simulations"),
        ),
      ),
    ).toEqual([
      "organizations",
      "profiles",
      "projects",
      "ai_settlement_rule_drafts",
    ]);

    expect(settlementAiAuthenticatedAuthoringRpcNames()).toEqual([
      "create_ai_settlement_rule_draft",
      "create_settlement_formula_simulation",
      "finalize_settlement_ai_draft_turn",
      "finalize_settlement_ai_simulation_turn",
      "finalize_settlement_ai_failed_turn",
    ]);

    for (const directRpc of [
      "create_ai_settlement_rule_draft",
      "create_settlement_formula_simulation",
    ]) {
      const body = settlementAiFunctionBody(directRpc);
      const parentLock = body.indexOf(
        "public.settlement_ai_lock_authoring_parents",
      );
      expect(
        parentLock,
        `${directRpc} must lock FK parents`,
      ).toBeGreaterThanOrEqual(0);
      expect(parentLock).toBeLessThan(body.indexOf("for update"));
    }
    const atomicLock = settlementAiFunctionBody(
      "settlement_ai_lock_atomic_draft_turn",
    );
    expect(
      atomicLock.indexOf("public.settlement_ai_lock_authoring_parents"),
    ).toBeLessThan(atomicLock.indexOf("from public.ai_conversations"));
    expect(
      settlementAiRowLocks("settlement_ai_lock_atomic_draft_turn"),
    ).toEqual([
      { relation: "ai_conversations", mode: "update" },
      { relation: "ai_chat_turns", mode: "update" },
    ]);
  });

  it("keeps replay-only child locks terminal and first writes in canonical order", () => {
    const draft = settlementAiFunctionBody("create_ai_settlement_rule_draft");
    const draftParent = draft.indexOf(
      "public.settlement_ai_lock_authoring_parents",
    );
    const conversation = draft.indexOf("from public.ai_conversations as c");
    const replayDraft = draft.indexOf("select d.* into v_existing");
    const replayDraftReturn = draft.indexOf(
      "return pg_catalog.to_jsonb(v_existing)",
      replayDraft,
    );
    const turn = draft.indexOf("from public.ai_chat_turns as trace_turn");
    const messages = draft.indexOf(
      "from public.ai_chat_messages as user_message",
    );
    const previousDraft = draft.indexOf("select d.* into v_previous");
    const draftInsert = draft.indexOf(
      "insert into public.ai_settlement_rule_drafts",
    );
    const draftPath = [
      draftParent,
      conversation,
      replayDraft,
      replayDraftReturn,
      turn,
      messages,
      previousDraft,
      draftInsert,
    ];
    expect(draftPath.every((index) => index >= 0)).toBe(true);
    expect(draftPath).toEqual(
      [...draftPath].sort((left, right) => left - right),
    );
    expect(draft.slice(previousDraft, draftInsert)).toContain("for update");

    const simulation = settlementAiFunctionBody(
      "create_settlement_formula_simulation",
    );
    const simulationParent = simulation.indexOf(
      "public.settlement_ai_lock_authoring_parents",
    );
    const replaySimulation = simulation.indexOf("select s.* into v_existing");
    const replaySimulationReturn = simulation.indexOf(
      "return pg_catalog.to_jsonb(v_existing)",
      replaySimulation,
    );
    const ownerDraft = simulation.indexOf("select d.* into v_draft");
    const simulationInsert = simulation.indexOf(
      "insert into public.settlement_formula_simulations",
    );
    const simulationPath = [
      simulationParent,
      replaySimulation,
      replaySimulationReturn,
      ownerDraft,
      simulationInsert,
    ];
    expect(simulationPath.every((index) => index >= 0)).toBe(true);
    expect(simulationPath).toEqual(
      [...simulationPath].sort((left, right) => left - right),
    );

    for (const finalizer of [
      "finalize_settlement_ai_draft_turn",
      "finalize_settlement_ai_simulation_turn",
      "finalize_settlement_ai_failed_turn",
    ]) {
      const body = settlementAiFunctionBody(finalizer);
      expect(
        body.indexOf("public.settlement_ai_lock_atomic_draft_turn"),
      ).toBeLessThan(body.indexOf("public.create_ai_settlement_rule_draft"));
    }
    const simulationFinalizer = settlementAiFunctionBody(
      "finalize_settlement_ai_simulation_turn",
    );
    expect(
      simulationFinalizer.indexOf("public.create_ai_settlement_rule_draft"),
    ).toBeLessThan(
      simulationFinalizer.indexOf(
        "public.create_settlement_formula_simulation",
      ),
    );
  });

  it("exposes only authenticated atomic finalizers and keeps helpers private", () => {
    for (const fn of [
      "finalize_settlement_ai_draft_turn",
      "finalize_settlement_ai_simulation_turn",
      "finalize_settlement_ai_failed_turn",
    ]) {
      expect(normalizedSettlementAiMigration).toContain(
        `revoke all on function public.${fn}(`,
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
      "revoke all on function public.settlement_ai_lock_atomic_draft_turn(jsonb)",
    );
    expect(normalizedSettlementAiMigration).not.toMatch(
      /grant execute on function public\.settlement_ai_lock_atomic_draft_turn/u,
    );
    expect(normalizedSettlementAiMigration).toMatch(
      /revoke all on function public\.settlement_ai_lock_authoring_parents\(uuid, uuid, uuid\)/u,
    );
    expect(normalizedSettlementAiMigration).not.toMatch(
      /grant execute on function public\.settlement_ai_lock_authoring_parents/u,
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
    expect(body).toContain(
      "trace_turn.user_message_id = v_trace_user_message_id",
    );
    expect(body).toContain(
      "trace_turn.assistant_message_id = v_trace_assistant_message_id",
    );
    expect(body).toContain(
      "trace_turn.status = case when p_status = 'failed' then 'failed' else 'completed' end",
    );
    expect(body).toContain("for update of trace_turn");
    expect(body).toContain("from public.ai_chat_messages as user_message");
    expect(body).toContain("join public.ai_chat_messages as assistant_message");
    expect(body).toContain("user_message.role = 'user'");
    expect(body).toContain("assistant_message.role = 'assistant'");
    expect(body).toContain("user_message.status = 'completed'");
    expect(body).toContain(
      "assistant_message.status = case when p_status = 'failed' then 'failed' else 'completed' end",
    );
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
    expect(normalizedSettlementAiMigration).not.toContain("pg_catalog.nullif(");
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
    ).toBeLessThan(
      createDraft.indexOf("insert into public.ai_settlement_rule_drafts"),
    );
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
        new RegExp(
          `grant execute on function public\\.${validatorName}\\(`,
          "u",
        ),
      );
    }

    const ambiguities = settlementAiFunctionBody(
      "settlement_ai_unresolved_ambiguities_is_valid",
    );
    expect(ambiguities).toContain(
      "pg_catalog.jsonb_array_length(p_value) > 100",
    );
    expect(ambiguities).toContain(
      "array['code', 'question', 'required']::text[]",
    );
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
    expect(safetyFlags).toContain(
      "pg_catalog.jsonb_array_length(p_value) > 100",
    );
    expect(safetyFlags).toContain(
      "array['code', 'severity', 'message']::text[]",
    );
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
    expect(draft).toContain("request_fingerprint ~ '^[0-9a-f]{64}$'");
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

  it("versions complete simulation summaries and guards all new inserts at v2", () => {
    expect(readdirSync(migrationsDir)).toContain(
      settlementSimulationSummaryV2MigrationName,
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "alter function public.settlement_ai_simulation_summary_is_valid",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "rename to settlement_ai_simulation_summary_v1_is_valid",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "create or replace function public.settlement_ai_simulation_summary_v2_is_valid",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "immutable set search_path = pg_catalog, public",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "'summaryschemaversion'",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "create trigger settlement_formula_simulations_require_v2 before insert on public.settlement_formula_simulations",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toContain(
      "public.settlement_ai_simulation_summary_v2_is_valid(",
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toMatch(
      /revoke all on function public\.settlement_ai_simulation_summary_v2_is_valid\(/u,
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toMatch(
      /revoke all on function public\.require_settlement_formula_simulation_summary_v2\(\)/u,
    );
    const rpcStart = normalizedSettlementSimulationSummaryV2Migration.indexOf(
      "create or replace function public.create_settlement_formula_simulation(",
    );
    const rpcEnd = normalizedSettlementSimulationSummaryV2Migration.indexOf(
      "revoke all on function public.settlement_ai_simulation_json_is_safe",
      rpcStart,
    );
    const rpc = normalizedSettlementSimulationSummaryV2Migration.slice(
      rpcStart,
      rpcEnd,
    );
    const wrapperValidation = rpc.indexOf(
      "public.settlement_ai_simulation_summary_is_valid(",
    );
    const existingLookup = rpc.indexOf("select s.* into v_existing");
    const duplicateReturn = rpc.indexOf(
      "return pg_catalog.to_jsonb(v_existing)",
    );
    const v2InsertGate = rpc.indexOf(
      "public.settlement_ai_simulation_summary_v2_is_valid(",
    );
    const insert = rpc.indexOf(
      "insert into public.settlement_formula_simulations",
    );
    expect(
      [
        wrapperValidation,
        existingLookup,
        duplicateReturn,
        v2InsertGate,
        insert,
      ].every((index) => index >= 0),
    ).toBe(true);
    expect([
      wrapperValidation,
      existingLookup,
      duplicateReturn,
      v2InsertGate,
      insert,
    ]).toEqual(
      [
        wrapperValidation,
        existingLookup,
        duplicateReturn,
        v2InsertGate,
        insert,
      ].sort((left, right) => left - right),
    );
    expect(normalizedSettlementSimulationSummaryV2Migration).toMatch(
      /\(p_coverage ->> 'reviewroutedrecords'\)::numeric \+ \(p_coverage ->> 'blockedrecords'\)::numeric <> \(p_coverage ->> 'skippedrecords'\)::numeric/u,
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
      selfChecks.match(/public\.create_ai_settlement_rule_draft\(/gu)?.length ??
        0,
    ).toBeGreaterThanOrEqual(5);
    expect(
      selfChecks.match(/public\.create_settlement_formula_simulation\(/gu)
        ?.length ?? 0,
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
      "atomic_draft_turn_not_completed",
      "atomic_draft_message_content_mismatch",
      "atomic_draft_replay_invalid",
      "atomic_completion_replay_mismatch_accepted",
      "atomic_simulation_turn_not_completed",
      "atomic_simulation_shape_invalid",
      "atomic_invalid_draft_rollback_failed",
      "atomic_invalid_simulation_rollback_failed",
      "atomic_failed_turn_not_failed",
      "atomic_failed_draft_shape_invalid",
      "atomic_failed_replay_invalid",
      "atomic_failed_retryable_mismatch_accepted",
      "atomic_failed_semantics_mismatch_accepted",
      "atomic_retry_turn_not_accepted",
      "unsafe_failure_semantics_rpc_accepted",
      "unsafe_failure_semantics_rollback_failed",
      "atomic_nonretryable_failure_not_persisted",
      "atomic_success_accepted_failed_turn",
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
    expect(selfChecks).toMatch(
      /public\.finalize_settlement_ai_failed_turn\([\s\S]+?'settlement_ai_provider_failed'[\s\S]+?'settlement ai provider is temporarily unavailable\.'[\s\S]+?true/u,
    );
    expect(selfChecks).toMatch(
      /public\.create_ai_chat_turn\([\s\S]+?'retry'[\s\S]+?v_atomic_failed_turn_id/u,
    );
    expect(selfChecks).toMatch(
      /atomic_turn\.status = 'failed'[\s\S]+?not atomic_turn\.retryable[\s\S]+?atomic_nonretryable_failure_not_persisted/u,
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

describe("Phase 1 settlement AI database authoring authorization", () => {
  it("gates every draft insert by exact authoring role and claimed session scope", () => {
    const migrationNames = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const runtimeHardeningIndex = migrationNames.indexOf(
      settlementRuntimeHardeningMigrationName,
    );
    const authoringHardeningIndex = migrationNames.indexOf(
      settlementAuthoringRoleHardeningMigrationName,
    );
    const phase2Index = migrationNames.findIndex(
      (file) => file >= "20260711120000",
    );

    expect(authoringHardeningIndex).toBeGreaterThan(runtimeHardeningIndex);
    if (phase2Index >= 0) {
      expect(authoringHardeningIndex).toBeLessThan(phase2Index);
    }

    const insertGuard = extractSettlementAuthoringRoleHardeningFunction(
      "guard_custom_settlement_ai_draft_authoring",
    );
    expect(insertGuard.definition).toContain("security definer");
    expect(insertGuard.definition).toContain(
      "set search_path = pg_catalog, public",
    );
    expect(insertGuard.body).toContain("v_actor_id uuid := auth.uid()");
    expect(insertGuard.body).toContain("v_actor_id is null");
    expect(insertGuard.body).toContain(
      "new.created_by is distinct from v_actor_id",
    );
    const authorRoleList = insertGuard.body.match(
      /public\.current_user_role\(new\.organization_id\) not in \(([^)]+)\)/u,
    )?.[1];
    expect(authorRoleList?.match(/'[a-z_]+'/gu)).toEqual([
      "'owner'",
      "'ops_manager'",
      "'operator_business'",
    ]);
    expect(insertGuard.body).toContain(
      "public.current_user_role(new.organization_id) is null",
    );
    const sessionLock = insertGuard.body.match(
      /perform 1 from public\.custom_settlement_ai_sessions as session[\s\S]+session\.organization_id = new\.organization_id[\s\S]+session\.project_id = new\.project_id[\s\S]+session\.conversation_id = new\.conversation_id[\s\S]+session\.actor_id = new\.created_by[\s\S]+for key share/u,
    )?.[0];
    expect(sessionLock).toBeDefined();
    expect(insertGuard.body.indexOf("if not found then")).toBeGreaterThan(
      insertGuard.body.indexOf(sessionLock ?? "missing session lock"),
    );
    expect(insertGuard.body).not.toContain("if not exists (");
    expect(insertGuard.body).toContain("return new");
    const dropTrigger =
      normalizedSettlementAuthoringRoleHardeningMigration.indexOf(
        "drop trigger if exists ai_settlement_rule_drafts_authoring_guard on public.ai_settlement_rule_drafts",
      );
    const createTrigger =
      normalizedSettlementAuthoringRoleHardeningMigration.indexOf(
        "create trigger ai_settlement_rule_drafts_authoring_guard before insert on public.ai_settlement_rule_drafts for each row execute function public.guard_custom_settlement_ai_draft_authoring()",
      );
    expect(dropTrigger).toBeGreaterThanOrEqual(0);
    expect(createTrigger).toBeGreaterThan(dropTrigger);
    expect(normalizedSettlementAuthoringRoleHardeningMigration).toContain(
      "revoke all on function public.guard_custom_settlement_ai_draft_authoring() from public, anon, authenticated, service_role",
    );
    expect(normalizedSettlementAuthoringRoleHardeningMigration).not.toMatch(
      /grant execute on function public\.guard_custom_settlement_ai_draft_authoring/u,
    );
  });

  it("gates direct and atomic draft entrypoints without removing finance simulation", () => {
    expect(
      settlementAiFunctionBody("create_ai_settlement_rule_draft"),
    ).toContain("insert into public.ai_settlement_rule_drafts");

    for (const finalizer of [
      "finalize_settlement_ai_draft_turn",
      "finalize_settlement_ai_simulation_turn",
      "finalize_settlement_ai_failed_turn",
    ]) {
      expect(settlementAiFunctionBody(finalizer)).toContain(
        "public.create_ai_settlement_rule_draft(",
      );
    }

    const independentSimulation = settlementAiFunctionBody(
      "create_settlement_formula_simulation",
    );
    expect(independentSimulation).toContain(
      "public.is_mcn_staff(p_organization_id)",
    );
    expect(normalizedSettlementAiMigration).toMatch(
      /grant execute on function public\.create_settlement_formula_simulation\([^;]+\) to authenticated;/u,
    );
    expect(normalizedSettlementAuthoringRoleHardeningMigration).not.toMatch(
      /(?:alter function|create or replace function) public\.create_settlement_formula_simulation/u,
    );
    expect(normalizedSettlementAuthoringRoleHardeningMigration).not.toMatch(
      /revoke all on function public\.create_settlement_formula_simulation/u,
    );
    expect(independentSimulation).not.toContain(
      "insert into public.ai_settlement_rule_drafts",
    );
    expect(normalizedSettlementAuthoringRoleHardeningMigration).not.toMatch(
      /(?:alter function|create or replace function) public\.settlement_ai_lock_authoring_parents/u,
    );
    for (const unchangedRpc of [
      "create_ai_settlement_rule_draft",
      "finalize_settlement_ai_draft_turn",
      "finalize_settlement_ai_simulation_turn",
      "finalize_settlement_ai_failed_turn",
    ]) {
      expect(normalizedSettlementAuthoringRoleHardeningMigration).not.toContain(
        `create or replace function public.${unchangedRpc}`,
      );
      expect(normalizedSettlementAuthoringRoleHardeningMigration).not.toContain(
        `alter function public.${unchangedRpc}`,
      );
    }
  });
});

describe("Phase 2 governed settlement rule schema contract", () => {
  it("declares governance tables and a bounded lifecycle request ledger", () => {
    expect(settlementGovernanceMigration).not.toBe("");

    const version = settlementGovernanceTableDefinition(
      "custom_settlement_rule_versions",
    );
    for (const column of [
      "id uuid primary key",
      "organization_id uuid not null",
      "project_id uuid not null",
      "scope text not null",
      "target_type text not null",
      "target_id uuid",
      "execution_grain text not null",
      "composition_mode text not null",
      "priority integer not null",
      "version_number integer not null",
      "status text not null",
      "formula text not null",
      "compiled_ast jsonb not null",
      "variables jsonb not null",
      "parameters jsonb not null",
      "rule_contract jsonb not null",
      "missing_data_policy jsonb not null",
      "test_cases jsonb not null",
      "simulation_summary jsonb not null",
      "formula_hash text not null",
      "rule_contract_hash text not null",
      "parameter_hash text not null",
      "variable_catalog_version text not null",
      "data_selection_hash text not null",
      "simulation_id uuid",
    ]) {
      expect(version).toContain(column);
    }
    expect(version).not.toContain("simulation_id uuid not null");
    expect(version).toMatch(
      /status in \(\s*'draft',\s*'pending_review',\s*'changes_requested',\s*'active',\s*'archived'\s*\)/u,
    );
    expect(version).toContain(
      "scope in ('receivable', 'payable', 'external_cost', 'reconciliation')",
    );
    expect(version).toContain(
      "target_type in ('project', 'streamer_group', 'project_streamer')",
    );
    expect(version).toMatch(
      /execution_grain in \(\s*'report',\s*'project_streamer_period',\s*'batch',\s*'project_period'\s*\)/u,
    );
    expect(version).toMatch(
      /composition_mode in \(\s*'replace',\s*'add',\s*'multiply',\s*'clamp',\s*'emit_items',\s*'check'\s*\)/u,
    );
    expect(version).toContain(
      "pg_catalog.jsonb_typeof(compiled_ast) = 'object'",
    );
    expect(version).toContain("pg_catalog.jsonb_typeof(variables) = 'array'");
    expect(version).toContain("pg_catalog.jsonb_typeof(parameters) = 'object'");
    expect(version).toContain(
      "pg_catalog.jsonb_typeof(rule_contract) = 'object'",
    );
    expect(version).toContain(
      "pg_catalog.jsonb_typeof(missing_data_policy) = 'object'",
    );
    expect(version).toContain("pg_catalog.jsonb_typeof(test_cases) = 'array'");
    expect(version).toContain(
      "pg_catalog.jsonb_typeof(simulation_summary) = 'object'",
    );
    expect(version).toContain("public.settlement_ai_json_within_budget(");
    expect(version).toContain(
      "public.settlement_ai_normalized_ast_is_valid(compiled_ast)",
    );
    expect(version).toContain(
      "public.settlement_ai_business_contract_is_valid(rule_contract)",
    );

    for (const table of [
      "custom_settlement_rule_review_events",
      "custom_settlement_rule_lifecycle_requests",
      "settlement_rule_group_lifecycle_requests",
      "settlement_rule_groups",
      "project_streamer_settlement_group_assignments",
      "settlement_rule_templates",
    ]) {
      expect(normalizedSettlementGovernanceMigration).toContain(
        `create table public.${table}`,
      );
    }
  });

  it("enforces target identity, version uniqueness, and one active target", () => {
    const version = settlementGovernanceTableDefinition(
      "custom_settlement_rule_versions",
    );

    expect(version).toContain("target_type = 'project' and target_id is null");
    expect(version).toContain(
      "target_type <> 'project' and target_id is not null",
    );
    expect(version).toContain("scope = 'payable' or target_type = 'project'");
    expect(version).toContain(
      "target_group_id uuid generated always as ( case when target_type = 'streamer_group' then target_id end ) stored",
    );
    expect(version).toContain(
      "target_project_streamer_id uuid generated always as ( case when target_type = 'project_streamer' then target_id end ) stored",
    );
    expect(version).toContain(
      "foreign key (target_group_id, organization_id, project_id) references public.settlement_rule_groups(id, organization_id, project_id)",
    );
    expect(version).toContain(
      "foreign key (target_project_streamer_id, organization_id, project_id) references public.project_streamers(id, organization_id, project_id)",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "constraint project_streamers_id_organization_project_key unique (id, organization_id, project_id)",
    );
    expect(normalizedSettlementGovernanceMigration).toMatch(
      /create unique index custom_settlement_rule_target_version_key on public\.custom_settlement_rule_versions \( organization_id, project_id, scope, target_type, coalesce\(target_id, '00000000-0000-0000-0000-000000000000'::uuid\), version_number \)/u,
    );
    expect(normalizedSettlementGovernanceMigration).toMatch(
      /create unique index custom_settlement_rule_one_active_target on public\.custom_settlement_rule_versions \( project_id, scope, target_type, coalesce\(target_id, '00000000-0000-0000-0000-000000000000'::uuid\) \) where status = 'active'/u,
    );

    for (const constraint of [
      "settlement_rule_groups_organization_fkey",
      "settlement_rule_groups_created_by_fkey",
      "custom_rule_versions_organization_fkey",
      "custom_rule_versions_created_by_fkey",
      "custom_rule_versions_approved_by_fkey",
      "custom_rule_review_events_organization_fkey",
      "custom_rule_review_events_actor_fkey",
      "project_streamer_group_assignments_organization_fkey",
      "project_streamer_group_assignments_actor_fkey",
      "settlement_rule_templates_organization_fkey",
      "settlement_rule_templates_created_by_fkey",
    ]) {
      expect(normalizedSettlementGovernanceMigration).toContain(
        `constraint ${constraint} foreign key`,
      );
      expect(constraint.length).toBeLessThanOrEqual(63);
    }
  });

  it("binds one immutable simulation and excludes approved range overlap", () => {
    expect(normalizedSettlementGovernanceMigration).toContain(
      "create extension if not exists btree_gist with schema extensions",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "constraint custom_settlement_rule_versions_effective_no_overlap exclude using gist",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "tstzrange(effective_from, effective_until, '[)') with &&",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "where (approved_at is not null and status in ('active', 'archived'))",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "constraint settlement_formula_simulations_rule_version_pair_key unique (id, rule_version_id, organization_id, project_id)",
    );
    expect(normalizedSettlementGovernanceMigration).toMatch(
      /constraint custom_settlement_rule_versions_simulation_scope_fkey foreign key \(simulation_id, id, organization_id, project_id\) references public\.settlement_formula_simulations\(\s*id,\s*rule_version_id,\s*organization_id,\s*project_id\s*\) on delete restrict deferrable initially deferred/u,
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "constraint settlement_formula_simulations_rule_version_scope_fkey foreign key (rule_version_id, organization_id, project_id) references public.custom_settlement_rule_versions(id, organization_id, project_id) on delete restrict deferrable initially deferred",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "create unique index settlement_formula_simulations_rule_version_key",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "unique (simulation_id)",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "drop constraint settlement_formula_simulations_exactly_one_owner",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "constraint custom_settlement_rule_versions_approved_archive_end_check check ( status <> 'archived' or approved_at is null or effective_until is not null )",
    );
  });

  it("makes reviews append-only and group assignments effective-dated", () => {
    const review = settlementGovernanceTableDefinition(
      "custom_settlement_rule_review_events",
    );
    expect(review).toMatch(
      /event_type in \(\s*'submitted',\s*'changes_requested',\s*'resubmitted',\s*'approved',\s*'force_approved',\s*'archived',\s*'activation_failed'\s*\)/u,
    );
    for (const column of [
      "actor_id uuid not null",
      "actor_role text not null",
      "reason text",
      "comment text",
      "before_status text",
      "after_status text",
      "risk_summary jsonb not null",
      "formula_hash text not null",
      "rule_contract_hash text not null",
      "parameter_hash text not null",
      "variable_catalog_version text not null",
      "data_selection_hash text not null",
      "created_at timestamptz not null",
    ]) {
      expect(review).toContain(column);
    }
    expect(normalizedSettlementGovernanceMigration).toContain(
      "create trigger custom_settlement_rule_review_events_immutable before update or delete on public.custom_settlement_rule_review_events",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "create trigger custom_settlement_rule_review_events_no_truncate before truncate on public.custom_settlement_rule_review_events",
    );

    const group = settlementGovernanceTableDefinition("settlement_rule_groups");
    expect(group).toContain("status in ('active', 'archived')");
    expect(group).toContain("status = 'active' and archived_at is null");
    expect(group).toContain("status = 'archived' and archived_at is not null");
    const assignment = settlementGovernanceTableDefinition(
      "project_streamer_settlement_group_assignments",
    );
    expect(assignment).toContain(
      "foreign key (project_streamer_id, organization_id, project_id) references public.project_streamers(id, organization_id, project_id)",
    );
    expect(assignment).toContain(
      "foreign key (group_id, organization_id, project_id) references public.settlement_rule_groups(id, organization_id, project_id)",
    );
    expect(assignment).toContain(
      "effective_until is null or effective_until > effective_from",
    );
    expect(assignment).toContain(
      "constraint project_streamer_settlement_group_assignments_no_overlap exclude using gist",
    );
    expect(assignment).toContain(
      "project_streamer_id with =, group_id with =, tstzrange(effective_from, effective_until, '[)') with &&",
    );
  });

  it("stores only organization templates and does not seed system templates", () => {
    const template = settlementGovernanceTableDefinition(
      "settlement_rule_templates",
    );
    for (const column of [
      "organization_id uuid not null",
      "source_rule_version_id uuid",
      "source_version_number integer",
      "source_scope text",
      "formula text not null",
      "compiled_ast jsonb not null",
      "variables jsonb not null",
      "parameters jsonb not null",
      "rule_contract jsonb not null",
      "status text not null",
    ]) {
      expect(template).toContain(column);
    }
    expect(template).toContain("status in ('active', 'archived')");
    expect(template).toContain(
      "foreign key (source_rule_version_id, organization_id) references public.custom_settlement_rule_versions(id, organization_id)",
    );
    expect(template).toContain(
      "foreign key ( source_rule_version_id, organization_id, source_project_id, source_version_number, source_scope ) references public.custom_settlement_rule_versions( id, organization_id, project_id, version_number, scope )",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "system_template",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "system settlement rule template",
    );
  });

  it("persists clone, parameter, and organization template reuse through server RPCs", () => {
    const clone = extractSettlementGovernanceFunction(
      "clone_custom_settlement_rule_to_draft",
    ).body;
    expect(clone).toContain("insert into public.custom_settlement_rule_versions");
    expect(clone).toContain("p_clone -> 'version'");
    expect(clone).toContain("simulation_id");
    expect(clone).toContain("null");
    expect(clone).toContain("p_source_rule_version_id");
    expect(clone).toContain("p_target_project_id");

    const parameter = extractSettlementGovernanceFunction(
      "create_custom_settlement_rule_parameter_draft",
    ).body;
    expect(parameter).toContain(
      "insert into public.custom_settlement_rule_versions",
    );
    expect(parameter).toContain("p_draft");
    expect(parameter).toContain("p_edits");
    expect(parameter).toContain("simulation_id");

    const saveTemplate = extractSettlementGovernanceFunction(
      "save_organization_settlement_rule_template",
    ).body;
    expect(saveTemplate).toContain("insert into public.settlement_rule_templates");
    expect(saveTemplate).toContain("p_confirmed_contract_hash");
    expect(saveTemplate).toContain("v_source.rule_contract_hash");
    expect(saveTemplate).not.toContain("approved_by");
    expect(saveTemplate).not.toContain("effective_from");

    const archiveTemplate = extractSettlementGovernanceFunction(
      "archive_organization_settlement_rule_template",
    ).body;
    expect(archiveTemplate).toContain(
      "update public.settlement_rule_templates",
    );
    expect(archiveTemplate).toContain("where template.id = p_template_id");
    expect(archiveTemplate).toContain("template.organization_id = p_organization_id");
  });

  it("freezes submitted payloads, governance fields, deletes, and review history", () => {
    const guardFunction = extractSettlementGovernanceFunction(
      "guard_custom_settlement_rule_version_mutation",
    );
    const guard = guardFunction.body;
    expect(guardFunction.definition).toContain(
      "set search_path = pg_catalog, public",
    );
    expect(guard).toContain("if tg_op = 'delete' then");
    expect(guard).toContain(
      "custom settlement rule versions cannot be deleted",
    );
    expect(guard).toContain("old.status = 'draft' and new.status = 'draft'");
    for (const field of [
      "formula",
      "compiled_ast",
      "variables",
      "parameters",
      "rule_contract",
      "missing_data_policy",
      "test_cases",
      "scope",
      "target_type",
      "target_id",
      "priority",
      "execution_grain",
      "composition_mode",
      "system_explanation_template",
      "formula_hash",
      "rule_contract_hash",
      "parameter_hash",
      "variable_catalog_version",
      "data_selection_hash",
      "simulation_id",
      "ai_draft_id",
    ]) {
      expect(guard).toContain(`'${field}'`);
    }
    for (const field of [
      "id",
      "organization_id",
      "project_id",
      "version_number",
      "created_by",
      "created_at",
    ]) {
      expect(guard).toContain(`new.${field} is distinct from old.${field}`);
    }
    expect(guard).toContain("custom settlement rule identity is immutable");
    for (const field of [
      "status",
      "effective_from",
      "effective_until",
      "approved_by",
      "approved_at",
      "archived_at",
    ]) {
      expect(guard).toContain(`new.${field} is distinct from old.${field}`);
    }
    for (const [before, after] of [
      ["draft", "pending_review"],
      ["pending_review", "changes_requested"],
      ["changes_requested", "draft"],
      ["pending_review", "active"],
      ["active", "archived"],
      ["draft", "archived"],
      ["changes_requested", "archived"],
    ]) {
      expect(guard).toContain(
        `old.status = '${before}' and new.status = '${after}'`,
      );
    }
    expect(guard).toContain(
      "custom settlement rule payload cannot change during status transition",
    );
    expect(guard).toContain(
      "governance fields require an allowed status transition",
    );
    expect(guard).toContain(
      "custom settlement rule status transition is not allowed",
    );
    for (const forbidden of [
      "set_config",
      "current_setting",
      "session_replication_role",
      "disable trigger",
      "enable trigger",
    ]) {
      expect(guard).not.toContain(forbidden);
    }
    expect(normalizedSettlementGovernanceMigration).toContain(
      "create trigger custom_settlement_rule_versions_guard before update or delete on public.custom_settlement_rule_versions",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "revoke all on function public.guard_custom_settlement_rule_version_mutation() from public, anon, authenticated, service_role",
    );
  });

  it("allows only project-scoped MCN reads and removes all direct writes", () => {
    for (const table of [
      "custom_settlement_rule_versions",
      "custom_settlement_rule_review_events",
      "settlement_rule_groups",
      "project_streamer_settlement_group_assignments",
      "settlement_rule_templates",
    ]) {
      expect(normalizedSettlementGovernanceMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(normalizedSettlementGovernanceMigration).toContain(
        `revoke all on table public.${table} from public, anon, authenticated, service_role`,
      );
      expect(normalizedSettlementGovernanceMigration).toContain(
        `grant select on table public.${table} to authenticated`,
      );
    }
    expect(normalizedSettlementGovernanceMigration).toContain(
      "alter table public.custom_settlement_rule_lifecycle_requests enable row level security",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "revoke all on table public.custom_settlement_rule_lifecycle_requests from public, anon, authenticated, service_role",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "grant select on table public.custom_settlement_rule_lifecycle_requests",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "alter table public.settlement_rule_group_lifecycle_requests enable row level security",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "revoke all on table public.settlement_rule_group_lifecycle_requests from public, anon, authenticated, service_role",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "grant select on table public.settlement_rule_group_lifecycle_requests",
    );
    for (const table of [
      "custom_settlement_rule_versions",
      "custom_settlement_rule_review_events",
      "settlement_rule_groups",
      "project_streamer_settlement_group_assignments",
    ]) {
      expect(normalizedSettlementGovernanceMigration).toMatch(
        new RegExp(
          `create policy ${table}_mcn_project_read on public\\.${table} for select using \\( auth\\.uid\\(\\) is not null and public\\.is_org_member\\(organization_id\\) and public\\.is_mcn_staff\\(organization_id\\) and public\\.can_access_project\\(project_id\\) \\)`,
          "u",
        ),
      );
    }
    expect(normalizedSettlementGovernanceMigration).toContain(
      "create policy settlement_rule_templates_mcn_org_read on public.settlement_rule_templates for select using ( auth.uid() is not null and public.is_org_member(organization_id) and public.is_mcn_staff(organization_id) )",
    );
    expect(normalizedSettlementGovernanceMigration).not.toMatch(
      /create policy [^;]+ for (?:insert|update|delete|all)/u,
    );
  });

  it("exposes fixed-search-path, role-gated lifecycle and group RPCs", () => {
    const expectedRoles: Record<string, string[]> = {
      create_settlement_rule_group: ["'owner'", "'ops_manager'"],
      save_custom_settlement_rule_draft: [
        "'owner'",
        "'ops_manager'",
        "'operator_business'",
      ],
      apply_and_submit_custom_settlement_rule: [
        "'owner'",
        "'ops_manager'",
        "'operator_business'",
      ],
      review_custom_settlement_rule: [
        "'owner'",
        "'ops_manager'",
        "'operator_business'",
        "'finance'",
      ],
      archive_custom_settlement_rule: ["'owner'", "'ops_manager'"],
      archive_settlement_rule_group: ["'owner'", "'ops_manager'"],
      change_settlement_group_assignment: ["'owner'", "'ops_manager'"],
    };

    for (const [fn, roles] of Object.entries(expectedRoles)) {
      const rpc = extractSettlementGovernanceFunction(fn);
      expect(rpc.definition).toContain("security definer");
      expect(rpc.definition).toContain("set search_path = pg_catalog, public");
      expect(rpc.body).toContain("v_actor_id uuid := auth.uid()");
      expect(rpc.body).toContain("public.is_org_member(p_organization_id)");
      expect(rpc.body).toContain("public.can_access_project(p_project_id)");
      expect(rpc.body).toContain("for update");
      expect(rpc.body).not.toContain(`${fn}_not_implemented_phase2_task1`);
      const roleList = rpc.body.match(
        /(?:public\.current_user_role\(p_organization_id\)|v_actor_role) not in \(([^)]+)\)/u,
      )?.[1];
      expect(roleList?.match(/'[a-z_]+'/gu)).toEqual(roles);
      expect(normalizedSettlementGovernanceMigration).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\([\\s\\S]+?from public, anon, authenticated, service_role;`,
          "u",
        ),
      );
      expect(normalizedSettlementGovernanceMigration).toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}\\([\\s\\S]+?to authenticated;`,
          "u",
        ),
      );
      expect(normalizedSettlementGovernanceMigration).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}\\([\\s\\S]+?to (?:public|anon|service_role);`,
          "u",
        ),
      );
    }
    for (const fn of [
      "create_settlement_rule_group",
      "archive_settlement_rule_group",
      "change_settlement_group_assignment",
    ]) {
      const body = extractSettlementGovernanceFunction(fn).body;
      expect(body).toContain("settlement_rule_group_lifecycle_requests");
      expect(body).toContain("v_request_fingerprint");
      expect(body).toContain("v_request_record");
      expect(body).toContain("settlement_rule_group_idempotency_conflict");
      expect(body).toContain("v_result");
    }

    const save = extractSettlementGovernanceFunction(
      "save_custom_settlement_rule_draft",
    ).body;
    const saveTargetLockSlice = save.slice(
      save.indexOf("from public.settlement_rule_groups"),
    );
    expect(
      saveTargetLockSlice.indexOf("from public.settlement_rule_groups"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      saveTargetLockSlice.indexOf("from public.settlement_rule_groups"),
    ).toBeLessThan(
      saveTargetLockSlice.indexOf("from public.project_streamers"),
    );
    expect(
      saveTargetLockSlice.indexOf("from public.project_streamers"),
    ).toBeLessThan(
      saveTargetLockSlice.indexOf(
        "from public.custom_settlement_rule_versions",
      ),
    );
    expect(save).toContain("p_scope not in (");
    expect(save).toContain("p_target_type not in (");

    const apply = extractSettlementGovernanceFunction(
      "apply_and_submit_custom_settlement_rule",
    ).body;
    expect(apply).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(apply).toContain("p_source_rule_version_id");
    expect(apply).toContain("v_request_fingerprint");
    expect(apply).toContain(
      "insert into public.custom_settlement_rule_versions",
    );
    expect(apply).toContain(
      "insert into public.settlement_formula_simulations",
    );
    expect(apply).toContain(
      "insert into public.custom_settlement_rule_review_events",
    );
    expect(apply).toContain("p_source_ai_draft_id is null");
    expect(apply).toContain("p_source_rule_version_id is null");
    expect(apply).toContain("p_submission_event_type");
    expect(apply).toContain("settlement_formula_simulations_exactly_one_owner");
    expect(apply).toContain("coverage ->> 'blockedrecords'");
    expect(apply).toContain("coverage ->> 'uncoveredrecords'");
    expect(apply).toContain(
      "v_data_selection_hash := v_source_version.data_selection_hash",
    );
    expect(apply).toContain("v_priority integer");
    expect(apply).toContain("v_priority := v_source_version.priority");
    expect(apply).toMatch(
      /v_priority := coalesce\(\s*\(v_source_draft\.business_contract ->> 'priority'\)::integer,\s*100\s*\)/u,
    );
    expect(apply).toContain("active_pending.priority = v_priority");
    expect(apply).toContain(
      "v_rule_contract ->> 'compositionmode', v_priority, v_version_number",
    );
    expect(apply).not.toContain("active_pending.priority = 100");
    expect(apply).not.toContain(
      "v_rule_contract ->> 'compositionMode', 100, v_version_number",
    );
    expect(apply).toContain("for update");
    expect(apply).toMatch(
      /pg_catalog\.pg_advisory_xact_lock[\s\S]+pg_catalog\.pg_advisory_xact_lock[\s\S]+from public\.custom_settlement_rule_versions/u,
    );

    const review = extractSettlementGovernanceFunction(
      "review_custom_settlement_rule",
    ).body;
    for (const marker of [
      "p_action = 'request_changes'",
      "p_action = 'reopen'",
      "p_action = 'approve'",
      "p_action = 'activation_failed'",
      "status = 'changes_requested'",
      "status = 'draft'",
      "status = 'active'",
      "status = 'archived'",
      "effective_until = p_effective_from",
      "'force', p_force",
      "'acknowledgment', p_acknowledgment",
    ]) {
      expect(review).toContain(marker);
    }
    expect(review).toMatch(
      /order by version\.version_number, version\.id[\s\S]+for update/u,
    );
    expect(review).toContain("v_approval_risk_summary");
    expect(review).toContain("custom_settlement_rule_client_risk_ignored");
    expect(review).toContain("custom_settlement_rule_approver_not_eligible");
    expect(review).toContain(
      "custom_settlement_rule_material_risk_requires_owner",
    );
    expect(review).toContain(
      "custom_settlement_rule_material_risk_requires_distinct_owner",
    );
    expect(review).toContain(
      "custom_settlement_rule_creator_requires_distinct_approver",
    );
    expect(review).toContain(
      "custom_settlement_rule_force_requires_single_owner",
    );
    expect(review).toContain(
      "from public.organization_members as approver_member",
    );
    expect(review).not.toContain(
      "p_risk_summary || pg_catalog.jsonb_build_object",
    );
    const reopenBranch = review.slice(
      review.indexOf("elsif p_action = 'reopen'"),
      review.indexOf("elsif p_action = 'approve'"),
    );
    expect(reopenBranch).toContain("v_event_id := null");
    expect(reopenBranch).not.toContain(
      "from public.custom_settlement_rule_review_events",
    );

    const archiveLifecycle = extractSettlementGovernanceFunction(
      "archive_custom_settlement_rule",
    ).body;
    expect(archiveLifecycle).toContain("p_fallback_proof");
    expect(archiveLifecycle).toContain("v_fallback_simulation");
    expect(archiveLifecycle).toContain(
      "custom_settlement_rule_archive_fallback_simulation_required",
    );
    expect(archiveLifecycle).toContain("archivedruleversionid");
    expect(archiveLifecycle).toContain("excludeslockedbatches");
    expect(archiveLifecycle).toContain(
      "v_fallback_simulation.id = v_version.simulation_id",
    );
    expect(archiveLifecycle).toContain("remainingcustomlayercount");
    expect(archiveLifecycle).toContain("fixedfallbackavailable");
    expect(archiveLifecycle).toContain("lockedbatchcount");
    expect(archiveLifecycle).toContain("effective_until = p_effective_until");

    for (const rpcName of [
      "save_custom_settlement_rule_draft",
      "apply_and_submit_custom_settlement_rule",
      "review_custom_settlement_rule",
      "archive_custom_settlement_rule",
    ]) {
      const body = extractSettlementGovernanceFunction(rpcName).body;
      expect(body).toContain("v_request_fingerprint");
      expect(body).toContain("v_request_key");
      expect(body).toContain("lifecycle_requests");
      expect(body).toContain("custom_settlement_rule_idempotency_conflict");
      for (const forbidden of [
        "set_config",
        "current_setting",
        "session_replication_role",
        "disable trigger",
      ]) {
        expect(body).not.toContain(forbidden);
      }
    }

    expect(normalizedSettlementGovernanceMigration).toContain(
      "create table public.custom_settlement_rule_lifecycle_requests",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "reopened_at timestamptz",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "custom_settlement_rule_draft_hashes_required",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "custom_settlement_rule_draft_hashes_must_change",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "custom_settlement_rule_resimulation_required",
    );
    expect(save).toContain("simulation.rule_version_id = v_existing.id");
    expect(save).toContain("custom_settlement_rule_resimulation_required");
    expect(save).toContain(
      "p_version_simulation_id = v_existing.simulation_id",
    );
    expect(save).toContain("v_existing.reopened_at is null");
    expect(save).toContain("simulation.ai_draft_id = v_existing.ai_draft_id");
    expect(save).toContain("simulation.created_at > v_existing.reopened_at");
    expect(save).toContain(
      "where old_simulation.id = v_existing.simulation_id",
    );
    expect(save).toContain("rule_version_id = null");
    expect(save).toContain("ai_draft_id = v_existing.ai_draft_id");
    expect(save).toContain("simulation_id = p_version_simulation_id");
    expect(save).toContain("where simulation.id = p_source_simulation_id");
    expect(normalizedSettlementGovernanceMigration).toContain(
      "v_request_record.version_snapshot",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "drop function if exists public.apply_and_submit_custom_settlement_rule",
    );
    expect(save).toContain(
      "p_scope <> 'payable' and p_target_type <> 'project'",
    );
    expect(save).toContain("custom_settlement_rule_target_invalid");
    expect(save).toContain("custom_settlement_rule_group_scope_mismatch");
    expect(save).toContain(
      "custom_settlement_rule_project_streamer_scope_mismatch",
    );

    const submit = extractSettlementGovernanceFunction(
      "apply_and_submit_custom_settlement_rule",
    ).body;
    const submitTargetLockSlice = submit.slice(
      submit.indexOf("from public.settlement_rule_groups"),
    );
    expect(
      submitTargetLockSlice.indexOf("from public.settlement_rule_groups"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      submitTargetLockSlice.indexOf("from public.settlement_rule_groups"),
    ).toBeLessThan(
      submitTargetLockSlice.indexOf("from public.project_streamers"),
    );
    expect(
      submitTargetLockSlice.indexOf("from public.project_streamers"),
    ).toBeLessThan(
      submitTargetLockSlice.indexOf(
        "from public.custom_settlement_rule_versions",
      ),
    );
    expect(
      submitTargetLockSlice.indexOf(
        "from public.custom_settlement_rule_versions",
      ),
    ).toBeLessThan(
      submitTargetLockSlice.indexOf("from public.ai_settlement_rule_drafts"),
    );
    expect(
      submitTargetLockSlice.indexOf("from public.ai_settlement_rule_drafts"),
    ).toBeLessThan(
      submitTargetLockSlice.indexOf(
        "from public.settlement_formula_simulations",
      ),
    );
    expect(submit).toContain("p_scope not in (");
    expect(submit).toContain("p_target_type not in (");
    expect(submit).toContain(
      "p_scope <> 'payable' and p_target_type <> 'project'",
    );
    expect(submit).toContain("custom_settlement_rule_target_invalid");
    expect(submit).toContain("custom_settlement_rule_draft_scope_mismatch");
    expect(submit).toContain(
      "custom_settlement_rule_simulation_scope_mismatch",
    );
    expect(submit).toContain("p_submission_event_type = 'resubmitted'");
    expect(submit).toContain("simulation.id = v_source_version.simulation_id");
    expect(submit).toContain(
      "simulation.rule_version_id = p_source_rule_version_id",
    );
    expect(submit).toContain(
      "simulation.created_at > v_source_version.reopened_at",
    );

    for (const fn of [
      "review_custom_settlement_rule",
      "archive_custom_settlement_rule",
    ]) {
      expect(extractSettlementGovernanceFunction(fn).body).toContain(
        "custom_settlement_rule_version_scope_mismatch",
      );
    }

    const assignment = extractSettlementGovernanceFunction(
      "change_settlement_group_assignment",
    ).body;
    expect(
      assignment.indexOf("from public.settlement_rule_groups"),
    ).toBeLessThan(assignment.indexOf("from public.project_streamers"));
    expect(assignment.indexOf("from public.project_streamers")).toBeLessThan(
      assignment.indexOf(
        "from public.project_streamer_settlement_group_assignments",
      ),
    );
    expect(assignment).toContain("settlement_rule_group_scope_mismatch");
    expect(assignment).toContain("project_streamer_scope_mismatch");
    expect(assignment).toContain("project_streamer.status = 'joined'");
    expect(assignment).toContain(
      "p_effective_until is not null and p_effective_until <= p_effective_from",
    );
    expect(assignment).toContain("insertedassignment");
    expect(assignment).toContain("closedassignmentids");
    expect(assignment).toContain("newgroupsnapshothash");
    expect(assignment).toContain(
      "update public.project_streamer_settlement_group_assignments",
    );
    expect(assignment).toContain(
      "insert into public.project_streamer_settlement_group_assignments",
    );
    expect(assignment).toContain(
      "settlement_group_assignment_locked_history_rewrite",
    );
    expect(assignment).not.toContain("and group_id <> p_group_id");
    expect(assignment).toContain(
      "insert into public.settlement_rule_group_snapshot_state",
    );
    expect(assignment).toContain("current_group_snapshot_hash");

    const createGroup = extractSettlementGovernanceFunction(
      "create_settlement_rule_group",
    ).body;
    expect(createGroup).toContain("insert into public.settlement_rule_groups");
    expect(createGroup).toContain(
      "settlement_rule_group_duplicate_active_name",
    );

    const archiveGroup = extractSettlementGovernanceFunction(
      "archive_settlement_rule_group",
    ).body;
    expect(archiveGroup).toContain("settlement_rule_group_archive_blocked");
    expect(archiveGroup).toContain(
      "from public.custom_settlement_rule_versions",
    );
    expect(archiveGroup).toContain(
      "from public.project_streamer_settlement_group_assignments",
    );

    expect(review).toContain(
      "settlement_group_simulation_population_incomplete",
    );
    expect(review).toContain(
      "settlement_group_simulation_population_missing_assigned",
    );
    expect(review).toContain(
      "settlement_group_simulation_population_missing_unassigned",
    );
    expect(review).toContain("assignedprojectstreamerids");
    expect(review).toContain("unassignedprojectstreamerids");
    expect(review).toContain("v_current_group_project_snapshot_hash");
    expect(review).toContain(
      "public.settlement_rule_group_project_snapshot_hash",
    );
    expect(review).toContain("p_effective_from");
    expect(review).toContain(
      "v_current_group_project_snapshot_hash is distinct from v_simulation.sample_selection",
    );
    expect(review).not.toContain(
      "current_group_snapshot.current_group_snapshot_hash is distinct from v_simulation.sample_selection",
    );
    expect(review).toContain("settlement_group_rule_conflict_blocking");
    expect(settlementGovernanceMigration).toContain(
      "current_group_snapshot_hash",
    );
    expect(submit).toContain("settlement_group_rule_conflict_blocking");
    expect(submit).toContain("candidate_assignment");
    expect(submit).toContain("active_pending_assignment");
    expect(review).toContain("candidate_assignment");
    expect(review).toContain("active_pending_assignment");
    expect(settlementGovernanceMigration).toContain(
      "create or replace view public.settlement_group_simulation_freshness",
    );
    expect(settlementGovernanceMigration).toContain(
      "create or replace function public.settlement_rule_group_project_snapshot_hash",
    );
    expect(normalizedSettlementGovernanceMigration).toContain(
      "public.settlement_rule_group_project_snapshot_hash( version.organization_id, version.project_id, version.effective_from",
    );
    expect(settlementGovernanceMigration).toContain(
      "'settlement_group_project_snapshot'",
    );

    const archive = extractSettlementGovernanceFunction(
      "archive_custom_settlement_rule",
    ).body;
    expect(archive).toContain("p_effective_until is null");
    expect(archive).toContain("custom_settlement_rule_archive_end_required");
    expect(archive.indexOf("p_effective_until is null")).toBeLessThan(
      archive.indexOf("from public.custom_settlement_rule_versions"),
    );
  });

  it("does not wire production settlement execution or duplicate conversations", () => {
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "generate_settlement_batch",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "create table public.ai_conversations",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "create table public.ai_chat_messages",
    );
    expect(normalizedSettlementGovernanceMigration).not.toContain(
      "create table public.ai_chat_turns",
    );
  });

  it("derives approval material risk from server-owned simulation and contract facts", () => {
    const review = extractSettlementGovernanceFunction(
      "review_custom_settlement_rule",
    ).body;
    const approvalBranch = review.slice(
      review.indexOf("elsif p_action = 'approve'"),
      review.indexOf("elsif p_action = 'activation_failed'"),
    );

    for (const code of [
      "negative_margin",
      "abnormal_total_increase",
      "red_evidence_payment",
      "money_changing_explicit_default",
      "group_level_replace",
      "overlapping_group_exception",
      "safety_cap_exceeded",
    ]) {
      expect(approvalBranch).toContain(code);
    }
    expect(approvalBranch).toContain("v_old_total_cents");
    expect(approvalBranch).toContain("v_new_total_cents");
    expect(approvalBranch).toContain("abnormaltotalincreasebps");
    expect(approvalBranch).toContain("v_safety_cap_cents");
    expect(approvalBranch).toMatch(
      /jsonb_array_elements\(\s*v_simulation\.scenarios\s*\)/u,
    );
    expect(approvalBranch).toContain("missingdataimpact");
    expect(approvalBranch).toContain("use_explicit_default");
    expect(approvalBranch).toContain("groupconflict");
    expect(approvalBranch).toContain("explicit_exception");
    expect(approvalBranch).toContain(
      "custom_rule_material_risk_server_owned_totals",
    );
    expect(approvalBranch).toContain(
      "custom_rule_material_risk_server_owned_scenarios",
    );
    expect(approvalBranch.indexOf("abnormal_total_increase")).toBeLessThan(
      approvalBranch.indexOf(
        "custom_settlement_rule_material_risk_requires_owner",
      ),
    );
    expect(approvalBranch.indexOf("safety_cap_exceeded")).toBeLessThan(
      approvalBranch.indexOf(
        "custom_settlement_rule_material_risk_requires_distinct_owner",
      ),
    );
    expect(approvalBranch).not.toMatch(
      /where warning\.value ->> 'code' in \([\s\S]+abnormal_total_increase[\s\S]+safety_cap_exceeded/u,
    );
    expect(approvalBranch).not.toMatch(
      /p_risk_summary[\s\S]+v_material_risk_codes/u,
    );
  });
});

describe("Task8 custom settlement runtime database contract", () => {
  it("keeps immutable base history and orders the forward hardening before Phase 2", () => {
    const migrationNames = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(migrationNames).toContain(settlementRuntimeMigrationName);
    expect(migrationNames).toContain(
      "20260711115500_xingyao_duplicate_lease_recovery.sql",
    );
    expect(migrationNames).toContain(settlementRuntimeHardeningMigrationName);
    expect(gitBlobOid(settlementRuntimeMigration)).toBe(
      "11519949a46a67ba41c31bb891174a99442ed322",
    );
    expect(normalizedSettlementRuntimeMigration).toContain(
      "create or replace function public.read_custom_settlement_evidence_snapshot( p_organization_id uuid, p_project_id uuid, p_scope text, p_period_start date, p_period_end date, p_max_sources integer )",
    );
    expect(normalizedSettlementRuntimeMigration).not.toContain(
      "p_max_record_count integer",
    );
    expect(settlementRuntimeMigrationName > settlementAiMigrationName).toBe(
      true,
    );
    expect(
      settlementRuntimeMigrationName <
        "20260711115500_xingyao_duplicate_lease_recovery.sql" &&
        "20260711115500_xingyao_duplicate_lease_recovery.sql" <
          settlementRuntimeHardeningMigrationName &&
        settlementRuntimeHardeningMigrationName <
          "20260711120000_custom_settlement_rule_governance.sql",
    ).toBe(true);
    expect(migrationNames).not.toContain(
      "20260712130000_custom_settlement_runtime_snapshot.sql",
    );
  });

  it("removes the recorded six-argument overload before granting the hardened RPC", () => {
    const legacyRevoke =
      "execute 'revoke all on function public.read_custom_settlement_evidence_snapshot(uuid, uuid, text, date, date, integer) from public, anon, authenticated, service_role'";
    const legacyDrop =
      "drop function if exists public.read_custom_settlement_evidence_snapshot( uuid, uuid, text, date, date, integer );";
    expect(normalizedSettlementRuntimeHardeningMigration).toContain(
      "pg_catalog.to_regprocedure( 'public.read_custom_settlement_evidence_snapshot(uuid,uuid,text,date,date,integer)' ) is not null",
    );
    expect(normalizedSettlementRuntimeHardeningMigration).toContain(
      legacyRevoke,
    );
    expect(normalizedSettlementRuntimeHardeningMigration).toContain(legacyDrop);
    expect(
      normalizedSettlementRuntimeHardeningMigration.indexOf(legacyRevoke),
    ).toBeLessThan(
      normalizedSettlementRuntimeHardeningMigration.indexOf(legacyDrop),
    );
    expect(normalizedSettlementRuntimeHardeningMigration).toContain(
      "create or replace function public.read_custom_settlement_evidence_snapshot( p_organization_id uuid, p_project_id uuid, p_scope text, p_period_start date, p_period_end date, p_business_timezone text, p_business_timezone_source text, p_execution_grain text, p_max_sources integer, p_max_record_count integer )",
    );
    expect(normalizedSettlementRuntimeHardeningMigration).toContain(
      "grant execute on function public.read_custom_settlement_evidence_snapshot( uuid, uuid, text, date, date, text, text, text, integer, integer ) to authenticated",
    );
    expect(normalizedSettlementRuntimeHardeningMigration).not.toMatch(
      /grant execute on function public\.read_custom_settlement_evidence_snapshot\([\s\S]+?to (?:anon|service_role|public);/u,
    );
  });

  it("keeps session claims service-owned, scope-bound, and uniquely idempotent", () => {
    const table = settlementRuntimeTableDefinition(
      "custom_settlement_ai_sessions",
    );

    for (const column of [
      "id uuid primary key",
      "organization_id uuid not null",
      "project_id uuid not null",
      "actor_id uuid not null",
      "client_request_id text not null",
      "title text not null",
      "request_fingerprint text not null",
      "conversation_id uuid not null",
      "created_at timestamptz not null",
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toContain(
      "unique (organization_id, project_id, actor_id, client_request_id)",
    );
    expect(table).toContain(
      "foreign key (project_id, organization_id) references public.projects(id, organization_id)",
    );
    expect(table).toContain(
      "foreign key ( conversation_id, organization_id, actor_id ) references public.ai_conversations( id, organization_id, owner_user_id )",
    );
    expect(table).toContain(
      "foreign key ( conversation_id, organization_id, project_id ) references public.ai_conversations( id, organization_id, project_id )",
    );
    expect(table).toMatch(/client_request_id.+char_length.+between 8 and 128/u);
    expect(table).toMatch(/request_fingerprint.+\^\[0-9a-f\].+64/u);
    expect(normalizedSettlementRuntimeMigration).toContain(
      "alter table public.custom_settlement_ai_sessions enable row level security",
    );
    expect(normalizedSettlementRuntimeMigration).not.toContain(
      "create policy custom_settlement_ai_sessions",
    );
    expect(normalizedSettlementRuntimeMigration).toContain(
      "unique index custom_settlement_ai_sessions_conversation_idx",
    );
  });

  it("claims exactly one generic conversation under a scope-safe advisory lock", () => {
    const definition = settlementRuntimeFunctionDefinition(
      "claim_custom_settlement_ai_session",
    );
    const body = settlementRuntimeFunctionBody(
      "claim_custom_settlement_ai_session",
    );

    expect(definition).toContain("returns jsonb");
    expect(definition).toContain("security definer");
    expect(definition).toContain("set search_path = pg_catalog, public");
    expect(definition).toContain("p_request_fingerprint text");
    expect(body).toContain("v_actor_id uuid := auth.uid()");
    expect(body).toContain(
      "public.current_user_role(p_organization_id) not in ( 'owner', 'ops_manager', 'operator_business' )",
    );
    expect(body).toContain("public.is_org_member(p_organization_id)");
    expect(body).toContain("public.can_access_project(p_project_id)");
    expect(body).toContain(
      "public.settlement_ai_lock_authoring_parents( p_organization_id, v_actor_id, p_project_id )",
    );
    expect(body).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(body).toContain("pg_catalog.hashtextextended");
    expect(body).toContain(
      "v_request_fingerprint text := p_request_fingerprint",
    );
    expect(body).toContain("p_request_fingerprint is null");
    expect(body).toMatch(/p_request_fingerprint !~ '\^\[0-9a-f\]\{64\}\$'/u);
    expect(body).not.toContain("extensions.digest");
    expect(body).toMatch(
      /from public\.custom_settlement_ai_sessions[\s\S]+organization_id = p_organization_id[\s\S]+project_id = p_project_id[\s\S]+actor_id = v_actor_id[\s\S]+client_request_id = v_client_request_id/u,
    );
    expect(
      body.indexOf("from public.custom_settlement_ai_sessions"),
    ).toBeLessThan(body.indexOf("insert into public.ai_conversations"));
    expect(body).toContain("custom_settlement_session_replay_mismatch");
    expect(body).toContain("insert into public.ai_conversations");
    expect(body).toContain("insert into public.custom_settlement_ai_sessions");
    expect(body).toContain("'duplicate', true");
    expect(body).toContain("'duplicate', false");
    for (const key of [
      "'id'",
      "'title'",
      "'status'",
      "'last_message_at'",
      "'created_at'",
      "'updated_at'",
      "'duplicate'",
    ]) {
      expect(body).toContain(key);
    }
    for (const forbiddenKey of [
      "'conversation_id'",
      "'organization_id'",
      "'project_id'",
      "'actor_id'",
      "'client_request_id'",
    ]) {
      expect(body).not.toContain(forbiddenKey);
    }
    expect(body).not.toContain("create_ai_conversation");
  });

  it("reads one bounded lock-consistent evidence snapshot with safe fields", () => {
    const definition = settlementRuntimeFunctionDefinition(
      "read_custom_settlement_evidence_snapshot",
    );
    const body = settlementRuntimeFunctionBody(
      "read_custom_settlement_evidence_snapshot",
    );

    expect(definition).toContain("returns jsonb");
    expect(definition).toContain("security definer");
    expect(definition).toContain("set search_path = pg_catalog, public");
    for (const parameter of [
      "p_business_timezone text",
      "p_business_timezone_source text",
      "p_execution_grain text",
      "p_max_record_count integer",
    ]) {
      expect(definition).toContain(parameter);
    }
    expect(body).toContain("p_scope is null");
    expect(body).toContain("p_scope not in ('payable', 'receivable')");
    expect(body).toContain("p_max_sources > 10000");
    expect(body).toContain("p_max_record_count > 500");
    expect(body).toContain("p_business_timezone is null");
    expect(body).toContain("from pg_catalog.pg_timezone_names");
    expect(body).toContain("p_business_timezone_source not in (");
    expect(body).toContain("p_execution_grain not in (");
    expect(body).toContain("p_period_end - p_period_start > 365");
    expect(body).not.toContain("p_period_end - p_period_start > 366");
    expect(body).toContain(
      "public.current_user_role(p_organization_id) not in ( 'owner', 'ops_manager', 'operator_business', 'finance' )",
    );
    expect(body).toContain(
      "public.settlement_ai_lock_authoring_parents( p_organization_id, v_actor_id, p_project_id )",
    );

    expect(body).not.toContain("lock_barrier as materialized");
    expect(body).not.toMatch(/locked_[a-z_]+ as materialized/u);
    expect(body).not.toContain("for update of");
    for (const sourceCte of [
      "selected_batches",
      "selected_items",
      "selected_reports",
      "selected_costs",
      "selected_project_streamers",
      "selected_streamers",
      "selected_tasks",
    ]) {
      const cte = extractBalancedSql(
        body,
        `${sourceCte} as materialized`,
      ).inner;
      expect(cte, `${sourceCte} must be bounded`).toContain(
        "limit p_max_sources + 1",
      );
      expect(
        cte,
        `${sourceCte} must preserve its MVCC row version`,
      ).not.toContain("for update");
      expect(cte, `${sourceCte} must select explicit safe fields`).not.toMatch(
        /select (?:batch|item|report|cost|project_streamer)\.\*/u,
      );
    }
    expect(body).toMatch(
      /source_counts as materialized[\s\S]+record_counts as materialized[\s\S]+selection_guard as materialized[\s\S]+batch_payload as materialized/u,
    );
    expect(body).toContain("batch.status = 'locked'");
    expect(body).toContain("batch.batch_type in ('payable', 'receivable')");
    expect(body).toContain("batch.period_start <= p_period_end");
    expect(body).toContain("batch.period_end >= p_period_start");
    expect(body).toContain("requested_batches as materialized");
    expect(body).toMatch(
      /not exists \(\s*select 1 from requested_batches\s*\)[\s\S]+report\.reviewed_at >= v_window_start/u,
    );
    const selectedItems = extractBalancedSql(
      body,
      "selected_items as materialized",
    ).inner;
    expect(selectedItems).not.toContain("live_report_id is not null");
    expect(body).toMatch(
      /report\.status = 'approved'[\s\S]+item\.live_report_id = report\.id[\s\S]+report\.reviewed_at >= v_window_start/u,
    );
    const selectedCosts = extractBalancedSql(
      body,
      "selected_costs as materialized",
    ).inner;
    expect(selectedCosts).toContain("cost.status = 'confirmed'");
    expect(selectedCosts).toMatch(
      /cost\.live_report_id is null[\s\S]+from selected_reports as report[\s\S]+report\.id = cost\.live_report_id/u,
    );
    expect(selectedCosts).toMatch(
      /cost\.settlement_batch_id is null[\s\S]+from selected_items as item[\s\S]+item\.settlement_batch_id = cost\.settlement_batch_id/u,
    );
    expect(selectedCosts).toMatch(
      /cost\.live_report_id is null[\s\S]+cost\.settlement_batch_id is null[\s\S]+cost\.created_at >= v_window_start/u,
    );
    expect(selectedCosts).not.toContain(" = any (");
    expect(selectedCosts).not.toContain("from selected_batches as batch");
    expect(body).not.toContain("source_payload");
    expect(body).toContain("cost.amount_cents::text");
    expect(
      settlementRuntimeFunctionBody("custom_settlement_snapshot_numeric_text"),
    ).toContain("pg_catalog.trim_scale");
    expect(body).toContain("at time zone p_business_timezone");
    expect(body).toContain("'business_timezone', p_business_timezone");
    expect(body).toContain(
      "'business_timezone_source', p_business_timezone_source",
    );
    expect(body).toContain("custom_settlement_snapshot_source_limit_exceeded");
    expect(body).toContain("custom_settlement_snapshot_record_limit_exceeded");
    expect(body).toContain("record_count <= p_max_record_count");
    expect(body).toContain("'source_counts'");
    expect(body).toContain("'record_count'");
    expect(body).toMatch(
      /batch_payload as materialized[\s\S]+where selection_guard\.within_limits[\s\S]+base_payload as materialized/u,
    );
    expect(body).toContain("'__limit_exceeded'");
    expect(body).toContain("'snapshot_hash'");
    expect(body).toContain("extensions.digest");
    expect(body).toMatch(
      /with selected_batches as materialized[\s\S]+selected_items as materialized[\s\S]+selected_reports as materialized[\s\S]+selected_costs as materialized[\s\S]+base_payload as materialized[\s\S]+select[\s\S]+into v_snapshot[\s\S]+from base_payload/u,
    );
    expect(body).toContain("'version', batch.version");
    expect(body.match(/'version', batch\.version/gu)).toHaveLength(2);
    expect(body).toContain("'live_task_id', report.live_task_id");
    expect(body).not.toMatch(
      /select (?:batch|item|report|cost|project_streamer)\.\*/u,
    );
    expect(body).not.toMatch(
      /select[\s\S]+jsonb_agg[\s\S]+into v_(?:batches|items|reports|costs|streamers)/u,
    );
    for (const key of [
      "settlement_batches",
      "settlement_batch_items",
      "live_reports",
      "project_cost_items",
      "project_streamers",
    ]) {
      expect(body).toContain(`'${key}'`);
    }
    expect(body).toMatch(/jsonb_agg\(.+order by/u);
  });

  it("exposes only the two authenticated RPCs and leaves tables/helpers private", () => {
    for (const [rpc, source] of [
      [
        "claim_custom_settlement_ai_session",
        normalizedSettlementRuntimeMigration,
      ],
      [
        "read_custom_settlement_evidence_snapshot",
        normalizedSettlementRuntimeHardeningMigration,
      ],
    ] as const) {
      expect(source).toMatch(
        new RegExp(
          `revoke all on function public\\.${rpc}\\([\\s\\S]+?from public, anon, authenticated, service_role;`,
          "u",
        ),
      );
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${rpc}\\([\\s\\S]+?to authenticated;`,
          "u",
        ),
      );
      expect(source).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${rpc}\\([\\s\\S]+?to (?:anon|service_role|public);`,
          "u",
        ),
      );
    }
    expect(normalizedSettlementRuntimeMigration).toContain(
      "revoke all on table public.custom_settlement_ai_sessions from public, anon, authenticated, service_role",
    );
    expect(normalizedSettlementRuntimeMigration).not.toMatch(
      /grant (?:select|insert|update|delete|all).+custom_settlement_ai_sessions/u,
    );
    expect(normalizedSettlementRuntimeMigration).toContain(
      "revoke all on function public.custom_settlement_snapshot_numeric_text(numeric) from public, anon, authenticated, service_role",
    );
  });

  it("executes real claim and snapshot assertions and removes every fixture", () => {
    const selfCheck = settlementRuntimeSelfCheckBlock();

    for (const marker of [
      "public.claim_custom_settlement_ai_session(",
      "public.read_custom_settlement_evidence_snapshot(",
      "runtime_claim_duplicate_failed",
      "runtime_claim_mismatch_accepted",
      "runtime_claim_title_mismatch_accepted",
      "runtime_finance_claim_accepted",
      "runtime_finance_snapshot_failed",
      "runtime_snapshot_null_scope_accepted",
      "runtime_snapshot_367_day_period_accepted",
      "runtime_cross_scope_snapshot_accepted",
      "runtime_snapshot_amount_not_text",
      "runtime_snapshot_limit_accepted",
      "runtime_empty_snapshot_failed",
      "runtime_snapshot_fixture_cleanup_failed",
    ]) {
      expect(selfCheck).toContain(marker);
    }
    expect(selfCheck).toContain("when others then");
    expect(selfCheck).toMatch(
      /delete from public\.custom_settlement_ai_sessions[\s\S]+delete from public\.ai_conversations/u,
    );
  });
});

const settlementRuntimeRegressionContainer =
  process.env.CUSTOM_SETTLEMENT_RUNTIME_DB_REGRESSION_CONTAINER;

describe.runIf(Boolean(settlementRuntimeRegressionContainer))(
  "Phase 2 governed settlement rule live catalog",
  () => {
    it("installs RLS, deferred ownership, exclusions, triggers, and least-privilege ACLs", () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const catalog = JSON.parse(
        runDockerSqlText(
          container,
          `
            with governance_tables(name) as (
              values
                ('custom_settlement_rule_versions'),
                ('custom_settlement_rule_review_events'),
                ('settlement_rule_groups'),
                ('project_streamer_settlement_group_assignments'),
                ('settlement_rule_group_snapshot_state'),
                ('settlement_rule_templates')
            ), governance_rpcs(name) as (
              values
                ('create_settlement_rule_group'),
                ('save_custom_settlement_rule_draft'),
                ('apply_and_submit_custom_settlement_rule'),
                ('review_custom_settlement_rule'),
                ('archive_custom_settlement_rule'),
                ('archive_settlement_rule_group'),
                ('change_settlement_group_assignment')
            )
            select pg_catalog.jsonb_build_object(
              'tables', (
                select pg_catalog.count(*)
                from pg_catalog.pg_class as relation
                join pg_catalog.pg_namespace as namespace
                  on namespace.oid = relation.relnamespace
                join governance_tables as expected
                  on expected.name = relation.relname
                where namespace.nspname = 'public'
                  and relation.relkind = 'r'
              ),
              'rls_tables', (
                select pg_catalog.count(*)
                from pg_catalog.pg_class as relation
                join pg_catalog.pg_namespace as namespace
                  on namespace.oid = relation.relnamespace
                join governance_tables as expected
                  on expected.name = relation.relname
                where namespace.nspname = 'public'
                  and relation.relrowsecurity
              ),
              'select_policies', (
                select pg_catalog.count(*)
                from pg_catalog.pg_policies as policy
                join governance_tables as expected
                  on expected.name = policy.tablename
                where policy.schemaname = 'public'
                  and policy.cmd = 'SELECT'
              ),
              'authenticated_select_grants', (
                select pg_catalog.count(*)
                from information_schema.role_table_grants as grant_row
                join governance_tables as expected
                  on expected.name = grant_row.table_name
                where grant_row.table_schema = 'public'
                  and grant_row.grantee = 'authenticated'
                  and grant_row.privilege_type = 'SELECT'
              ),
              'direct_write_grants', (
                select pg_catalog.count(*)
                from information_schema.role_table_grants as grant_row
                join governance_tables as expected
                  on expected.name = grant_row.table_name
                where grant_row.table_schema = 'public'
                  and grant_row.grantee in (
                    'anon',
                    'authenticated',
                    'service_role'
                  )
                  and grant_row.privilege_type in (
                    'INSERT',
                    'UPDATE',
                    'DELETE',
                    'TRUNCATE'
                  )
              ),
              'deferred_cycle_fks', (
                select pg_catalog.count(*)
                from pg_catalog.pg_constraint
                where conname in (
                  'custom_settlement_rule_versions_simulation_scope_fkey',
                  'settlement_formula_simulations_rule_version_scope_fkey'
                )
                  and contype = 'f'
                  and condeferrable
                  and condeferred
              ),
              'exactly_one_owner', (
                select pg_catalog.count(*)
                from pg_catalog.pg_constraint
                where conname =
                  'settlement_formula_simulations_exactly_one_owner'
                  and contype = 'c'
              ),
              'exclusions', (
                select pg_catalog.count(*)
                from pg_catalog.pg_constraint
                where conname in (
                  'custom_settlement_rule_versions_effective_no_overlap',
                  'project_streamer_settlement_group_assignments_no_overlap'
                )
                  and contype = 'x'
              ),
              'immutability_triggers', (
                select pg_catalog.count(*)
                from pg_catalog.pg_trigger
                where tgname in (
                  'custom_settlement_rule_versions_guard',
                  'custom_settlement_rule_review_events_immutable',
                  'custom_settlement_rule_review_events_no_truncate'
                )
                  and not tgisinternal
              ),
              'secure_rpcs', (
                select pg_catalog.count(*)
                from pg_catalog.pg_proc as procedure
                join pg_catalog.pg_namespace as namespace
                  on namespace.oid = procedure.pronamespace
                join governance_rpcs as expected
                  on expected.name = procedure.proname
                where namespace.nspname = 'public'
                  and procedure.prosecdef
                  and procedure.proconfig @>
                    array['search_path=pg_catalog, public']::text[]
                  and pg_catalog.has_function_privilege(
                    'authenticated',
                    procedure.oid,
                    'EXECUTE'
                  )
                  and not pg_catalog.has_function_privilege(
                    'anon',
                    procedure.oid,
                    'EXECUTE'
                  )
                  and not pg_catalog.has_function_privilege(
                    'service_role',
                    procedure.oid,
                    'EXECUTE'
                  )
                  and not exists (
                    select 1
                    from pg_catalog.aclexplode(
                      coalesce(
                        procedure.proacl,
                        pg_catalog.acldefault('f', procedure.proowner)
                      )
                    ) as acl
                    where acl.grantee = 0
                      and acl.privilege_type = 'EXECUTE'
                  )
              )
            )::text;
          `,
        ),
      ) as Record<string, number>;

      expect(catalog).toEqual({
        tables: 5,
        rls_tables: 5,
        select_policies: 5,
        authenticated_select_grants: 5,
        direct_write_grants: 0,
        deferred_cycle_fks: 2,
        exactly_one_owner: 1,
        exclusions: 2,
        immutability_triggers: 3,
        secure_rpcs: 7,
      });
    });

    it("enforces reciprocal pairs, controlled transitions, and effective ranges", async () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const actorId = "9f110000-0000-4000-8000-000000000001";
      const organizationId = "9f120000-0000-4000-8000-000000000001";
      const projectId = "9f130000-0000-4000-8000-000000000001";
      const versionOneId = "9f140000-0000-4000-8000-000000000001";
      const versionTwoId = "9f140000-0000-4000-8000-000000000002";
      const versionThreeId = "9f140000-0000-4000-8000-000000000003";
      const simulationOneId = "9f150000-0000-4000-8000-000000000001";
      const simulationTwoId = "9f150000-0000-4000-8000-000000000002";
      const simulationThreeId = "9f150000-0000-4000-8000-000000000003";
      const effectiveStart = "2026-07-01T00:00:00Z";
      const replacementStart = "2026-08-01T00:00:00Z";
      const overlapStart = "2026-07-15T00:00:00Z";
      const overlapEnd = "2026-08-15T00:00:00Z";
      const formulaHash = "c".repeat(64);
      const ruleContractHash = "b".repeat(64);
      const parameterHash = "d".repeat(64);
      const variableCatalogVersion = "a".repeat(64);
      const dataSelectionHash = "e".repeat(64);
      const compiledAst = { kind: "identifier", name: "grossRevenue" };
      const testCases = [
        {
          name: "标准场景",
          inputs: {
            grossRevenue: { type: "money_cents", amountCents: 10_000 },
          },
          expectedResult: { type: "money_cents", amountCents: 10_000 },
        },
      ];
      const simulation = {
        sampleSource: { kind: "historical_settlements" },
        sampleSelection: {
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          populationCount: 20,
          sampledCount: 20,
          criteria: ["confirmed"],
        },
        coverage: {
          summarySchemaVersion: 2,
          totalRecords: 20,
          evaluatedRecords: 20,
          skippedRecords: 0,
          uncoveredRecords: 0,
          zeroAmountRecords: 0,
          reviewRoutedRecords: 0,
          blockedRecords: 0,
        },
        scenarios: [
          {
            id: "contract:000001",
            category: "contract_example",
            outcome: "calculated",
            amountCents: "10000",
            expectedAmountCents: "10000",
            passed: true,
          },
        ],
        historicalTotals: {
          oldPayableAmountCents: null,
          oldReceivableAmountCents: "10000",
          newPayableAmountCents: null,
          newReceivableAmountCents: "10000",
          recordCount: 20,
          verificationStatus: "verified",
        },
        deltas: {
          payableAmountCents: null,
          receivableAmountCents: "0",
          percentageBps: 0,
          marginImpactCents: "0",
        },
        largestChanges: [],
        warnings: [],
      };
      const setupSql = `
        insert into auth.users (id, email) values (
          '${actorId}'::uuid,
          'phase2-simulation-pair@example.invalid'
        );
        insert into public.profiles (id, email, full_name) values (
          '${actorId}'::uuid,
          'phase2-simulation-pair@example.invalid',
          'Phase2 Simulation Pair'
        );
        insert into public.organizations (id, name, code) values (
          '${organizationId}'::uuid,
          'Phase2 Simulation Pair',
          'phase2-simulation-pair'
        );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values (
          '${organizationId}'::uuid,
          '${actorId}'::uuid,
          'owner',
          'active'
        );
        insert into public.projects (
          id, organization_id, code, name, created_by, owner_id
        ) values (
          '${projectId}'::uuid,
          '${organizationId}'::uuid,
          'phase2-simulation-pair',
          'Phase2 Simulation Pair',
          '${actorId}'::uuid,
          '${actorId}'::uuid
        );
      `;
      const pairRowsSql = (crossed: boolean): string => `
        insert into public.custom_settlement_rule_versions (
          id, organization_id, project_id, scope, target_type, target_id,
          execution_grain, composition_mode, priority, version_number,
          status, formula, compiled_ast, variables, parameters,
          rule_contract, system_explanation_template, missing_data_policy,
          test_cases, simulation_summary, formula_hash, rule_contract_hash,
          parameter_hash, variable_catalog_version, data_selection_hash,
          simulation_id, created_by
        ) values
          (
            '${versionOneId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'receivable', 'project', null, 'report', 'replace', 100, 1,
            'draft', 'grossRevenue', ${sqlJson(compiledAst)}, '[]'::jsonb,
            '{}'::jsonb, ${sqlJson(settlementAiCanonicalBusinessContract())},
            '项目确认收入作为应收金额。', '{}'::jsonb,
            ${sqlJson(testCases)}, '{}'::jsonb, '${formulaHash}',
            '${ruleContractHash}', '${parameterHash}',
            '${variableCatalogVersion}', '${dataSelectionHash}',
            '${simulationOneId}'::uuid, '${actorId}'::uuid
          ),
          (
            '${versionTwoId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'receivable', 'project', null, 'report', 'replace', 100, 2,
            'draft', 'grossRevenue', ${sqlJson(compiledAst)}, '[]'::jsonb,
            '{}'::jsonb, ${sqlJson(settlementAiCanonicalBusinessContract())},
            '项目确认收入作为应收金额。', '{}'::jsonb,
            ${sqlJson(testCases)}, '{}'::jsonb, '${formulaHash}',
            '${ruleContractHash}', '${parameterHash}',
            '${variableCatalogVersion}', '${dataSelectionHash}',
            '${simulationTwoId}'::uuid, '${actorId}'::uuid
          );
        insert into public.settlement_formula_simulations (
          id, organization_id, project_id, rule_version_id, ai_draft_id,
          formula_hash, rule_contract_hash, parameter_hash,
          variable_catalog_version, data_selection_hash, sample_source,
          sample_selection, coverage, scenarios, historical_totals, deltas,
          largest_changes, warnings, idempotency_key, created_by
        ) values
          (
            '${simulationOneId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${crossed ? versionTwoId : versionOneId}'::uuid,
            null, '${formulaHash}', '${ruleContractHash}', '${parameterHash}',
            '${variableCatalogVersion}', '${dataSelectionHash}',
            ${sqlJson(simulation.sampleSource)},
            ${sqlJson(simulation.sampleSelection)},
            ${sqlJson(simulation.coverage)}, ${sqlJson(simulation.scenarios)},
            ${sqlJson(simulation.historicalTotals)},
            ${sqlJson(simulation.deltas)},
            ${sqlJson(simulation.largestChanges)},
            ${sqlJson(simulation.warnings)},
            'phase2-simulation-pair-1', '${actorId}'::uuid
          ),
          (
            '${simulationTwoId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${crossed ? versionOneId : versionTwoId}'::uuid,
            null, '${formulaHash}', '${ruleContractHash}', '${parameterHash}',
            '${variableCatalogVersion}', '${dataSelectionHash}',
            ${sqlJson(simulation.sampleSource)},
            ${sqlJson(simulation.sampleSelection)},
            ${sqlJson(simulation.coverage)}, ${sqlJson(simulation.scenarios)},
            ${sqlJson(simulation.historicalTotals)},
            ${sqlJson(simulation.deltas)},
            ${sqlJson(simulation.largestChanges)},
            ${sqlJson(simulation.warnings)},
            'phase2-simulation-pair-2', '${actorId}'::uuid
          );
      `;
      const governanceWrapperSql = `
        create function public.phase2_test_governance_transition(
          p_rule_version_id uuid,
          p_status text,
          p_effective_from timestamptz,
          p_effective_until timestamptz,
          p_approved_by uuid,
          p_approved_at timestamptz,
          p_archived_at timestamptz,
          p_reason text,
          p_explanation text
        )
        returns void
        language plpgsql
        security definer
        set search_path = pg_catalog, public
        as $wrapper$
        begin
          update public.custom_settlement_rule_versions
          set status = p_status,
              effective_from = coalesce(
                p_effective_from,
                effective_from
              ),
              effective_until = coalesce(
                p_effective_until,
                effective_until
              ),
              approved_by = coalesce(p_approved_by, approved_by),
              approved_at = coalesce(p_approved_at, approved_at),
              archived_at = coalesce(p_archived_at, archived_at),
              reason = coalesce(p_reason, reason),
              system_explanation_template = coalesce(
                p_explanation,
                system_explanation_template
              )
          where id = p_rule_version_id;
          if not found then
            raise exception 'phase2_test_rule_not_found';
          end if;
        end;
        $wrapper$;
        revoke all on function public.phase2_test_governance_transition(
          uuid, text, timestamptz, timestamptz, uuid, timestamptz,
          timestamptz, text, text
        ) from public, anon, authenticated, service_role;
        grant execute on function public.phase2_test_governance_transition(
          uuid, text, timestamptz, timestamptz, uuid, timestamptz,
          timestamptz, text, text
        ) to authenticated;
      `;
      const transitionCall = (input: {
        approvedAt?: string;
        approvedBy?: string;
        archivedAt?: string;
        effectiveFrom?: string;
        effectiveUntil?: string;
        explanation?: string;
        reason?: string;
        status: string;
        versionId: string;
      }): string => `
        select public.phase2_test_governance_transition(
          '${input.versionId}'::uuid,
          ${sqlString(input.status)},
          ${input.effectiveFrom ? `${sqlString(input.effectiveFrom)}::timestamptz` : "null::timestamptz"},
          ${input.effectiveUntil ? `${sqlString(input.effectiveUntil)}::timestamptz` : "null::timestamptz"},
          ${input.approvedBy ? `'${input.approvedBy}'::uuid` : "null::uuid"},
          ${input.approvedAt ? `${sqlString(input.approvedAt)}::timestamptz` : "null::timestamptz"},
          ${input.archivedAt ? `${sqlString(input.archivedAt)}::timestamptz` : "null::timestamptz"},
          ${input.reason ? sqlString(input.reason) : "null::text"},
          ${input.explanation ? sqlString(input.explanation) : "null::text"}
        );
      `;

      const residueSql = `
        select concat_ws(
          '|',
          (
            select pg_catalog.count(*)
            from public.custom_settlement_rule_versions
            where organization_id = '${organizationId}'::uuid
          ),
          (
            select pg_catalog.count(*)
            from public.settlement_formula_simulations
            where organization_id = '${organizationId}'::uuid
          ),
          (
            select pg_catalog.count(*)
            from public.organizations
            where id = '${organizationId}'::uuid
          ),
          (
            pg_catalog.to_regprocedure(
              'public.phase2_test_governance_transition(uuid,text,timestamptz,timestamptz,uuid,timestamptz,timestamptz,text,text)'
            ) is null
          )
        );
      `;

      expect(runDockerSqlText(container, residueSql)).toBe("0|0|0|t");
      runDockerSql(
        container,
        `
          begin;
          ${setupSql}
          ${pairRowsSql(false)}
          set constraints all immediate;
          set constraints
            custom_settlement_rule_versions_simulation_scope_fkey,
            settlement_formula_simulations_rule_version_scope_fkey
            deferred;
          ${governanceWrapperSql}

          set local role authenticated;
          select pg_catalog.set_config(
            'request.jwt.claim.sub', '${actorId}', true
          );
          do $direct_update$
          begin
            begin
              update public.custom_settlement_rule_versions
              set status = 'pending_review'
              where id = '${versionOneId}'::uuid;
              raise exception 'phase2_direct_update_accepted';
            exception
              when insufficient_privilege then null;
              when others then
                if sqlerrm = 'phase2_direct_update_accepted' then
                  raise;
                end if;
                raise exception 'phase2_direct_update_wrong_error: %', sqlerrm;
            end;
          end;
          $direct_update$;

          do $direct_lifecycle_request_insert$
          begin
            begin
              insert into public.custom_settlement_rule_lifecycle_requests (
                actor_id, client_request_id, organization_id, project_id,
                rule_version_id, request_fingerprint, version_snapshot
              ) values (
                '${actorId}'::uuid,
                'phase2-direct-ledger-write',
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                '${versionOneId}'::uuid,
                '${"a".repeat(64)}',
                '{}'::jsonb
              );
              raise exception 'phase2_direct_ledger_insert_accepted';
            exception
              when insufficient_privilege then null;
              when others then
                if sqlerrm = 'phase2_direct_ledger_insert_accepted' then
                  raise;
                end if;
                raise exception
                  'phase2_direct_ledger_insert_wrong_error: %', sqlerrm;
            end;
          end;
          $direct_lifecycle_request_insert$;

          do $governance_without_transition$
          begin
            begin
              perform public.phase2_test_governance_transition(
                '${versionOneId}'::uuid,
                'draft',
                '${effectiveStart}'::timestamptz,
                null,
                null,
                null,
                null,
                null,
                null
              );
              raise exception 'phase2_governance_without_transition_accepted';
            exception
              when others then
                if sqlerrm =
                   'phase2_governance_without_transition_accepted' then
                  raise;
                end if;
                if sqlerrm <>
                   'governance fields require an allowed status transition' then
                  raise exception
                    'phase2_governance_without_transition_wrong_error: %',
                    sqlerrm;
                end if;
            end;
          end;
          $governance_without_transition$;

          do $illegal_transition$
          begin
            begin
              perform public.phase2_test_governance_transition(
                '${versionOneId}'::uuid,
                'active',
                '${effectiveStart}'::timestamptz,
                null,
                '${actorId}'::uuid,
                '${effectiveStart}'::timestamptz,
                null,
                '非法直接激活',
                null
              );
              raise exception 'phase2_illegal_transition_accepted';
            exception
              when others then
                if sqlerrm = 'phase2_illegal_transition_accepted' then
                  raise;
                end if;
                if sqlerrm <>
                   'custom settlement rule status transition is not allowed' then
                  raise exception 'phase2_illegal_transition_wrong_error: %',
                    sqlerrm;
                end if;
            end;
          end;
          $illegal_transition$;

          do $payload_steal$
          begin
            begin
              perform public.phase2_test_governance_transition(
                '${versionOneId}'::uuid,
                'pending_review',
                null,
                null,
                null,
                null,
                null,
                null,
                '状态转换时偷改说明'
              );
              raise exception 'phase2_payload_steal_accepted';
            exception
              when others then
                if sqlerrm = 'phase2_payload_steal_accepted' then
                  raise;
                end if;
                if sqlerrm <>
                   'custom settlement rule payload cannot change during status transition' then
                  raise exception 'phase2_payload_steal_wrong_error: %',
                    sqlerrm;
                end if;
            end;
          end;
          $payload_steal$;

          ${transitionCall({ versionId: versionOneId, status: "pending_review" })}
          ${transitionCall({ versionId: versionOneId, status: "changes_requested", reason: "请补充规则说明" })}

          do $requested_changes_payload_steal$
          begin
            begin
              perform public.phase2_test_governance_transition(
                '${versionOneId}'::uuid,
                'draft',
                null,
                null,
                null,
                null,
                null,
                null,
                '请求修改转草稿时偷改说明'
              );
              raise exception
                'phase2_requested_changes_payload_steal_accepted';
            exception
              when others then
                if sqlerrm =
                   'phase2_requested_changes_payload_steal_accepted' then
                  raise;
                end if;
                if sqlerrm <>
                   'custom settlement rule payload cannot change during status transition' then
                  raise exception
                    'phase2_requested_changes_payload_steal_wrong_error: %',
                    sqlerrm;
                end if;
            end;
          end;
          $requested_changes_payload_steal$;

          ${transitionCall({ versionId: versionOneId, status: "draft" })}
          ${transitionCall({
            versionId: versionOneId,
            status: "draft",
            explanation: "请求修改转草稿后第二次更新说明。",
          })}
          ${transitionCall({ versionId: versionOneId, status: "pending_review" })}
          ${transitionCall({
            versionId: versionOneId,
            status: "active",
            effectiveFrom: effectiveStart,
            approvedBy: actorId,
            approvedAt: effectiveStart,
            reason: "批准首版",
          })}

          do $approved_archive_without_end$
          declare
            v_constraint_name text;
          begin
            begin
              perform public.phase2_test_governance_transition(
                '${versionOneId}'::uuid,
                'archived',
                null,
                null,
                null,
                null,
                '${replacementStart}'::timestamptz,
                '缺少生效结束时间',
                null
              );
              raise exception 'phase2_approved_archive_without_end_accepted';
            exception
              when check_violation then
                get stacked diagnostics
                  v_constraint_name = constraint_name;
                if v_constraint_name <>
                   'custom_settlement_rule_versions_approved_archive_end_check' then
                  raise exception
                    'phase2_approved_archive_without_end_wrong_constraint: %',
                    v_constraint_name;
                end if;
            end;
          end;
          $approved_archive_without_end$;

          ${transitionCall({
            versionId: versionOneId,
            status: "archived",
            effectiveUntil: replacementStart,
            archivedAt: replacementStart,
            reason: "由相邻版本接替",
          })}
          ${transitionCall({ versionId: versionTwoId, status: "pending_review" })}
          ${transitionCall({
            versionId: versionTwoId,
            status: "active",
            effectiveFrom: replacementStart,
            approvedBy: actorId,
            approvedAt: replacementStart,
            reason: "批准相邻版本",
          })}
          reset role;

          do $adjacent_ranges$
          begin
            if (
              select pg_catalog.count(*)
              from public.custom_settlement_rule_versions as version
              where (
                version.id = '${versionOneId}'::uuid
                and version.status = 'archived'
                and version.effective_from = '${effectiveStart}'::timestamptz
                and version.effective_until =
                  '${replacementStart}'::timestamptz
              ) or (
                version.id = '${versionTwoId}'::uuid
                and version.status = 'active'
                and version.effective_from =
                  '${replacementStart}'::timestamptz
                and version.effective_until is null
              )
            ) <> 2 then
              raise exception 'phase2_adjacent_ranges_not_persisted';
            end if;
          end;
          $adjacent_ranges$;

          do $overlap$
          declare
            v_constraint_name text;
          begin
            begin
              insert into public.settlement_formula_simulations (
                id, organization_id, project_id, rule_version_id,
                ai_draft_id, formula_hash, rule_contract_hash,
                parameter_hash, variable_catalog_version,
                data_selection_hash, sample_source, sample_selection,
                coverage, scenarios, historical_totals, deltas,
                largest_changes, warnings, idempotency_key, created_by
              )
              select
                '${simulationThreeId}'::uuid,
                simulation.organization_id,
                simulation.project_id,
                '${versionThreeId}'::uuid,
                null,
                simulation.formula_hash,
                simulation.rule_contract_hash,
                simulation.parameter_hash,
                simulation.variable_catalog_version,
                simulation.data_selection_hash,
                simulation.sample_source,
                simulation.sample_selection,
                simulation.coverage,
                simulation.scenarios,
                simulation.historical_totals,
                simulation.deltas,
                simulation.largest_changes,
                simulation.warnings,
                'phase2-simulation-pair-3',
                simulation.created_by
              from public.settlement_formula_simulations as simulation
              where simulation.id = '${simulationTwoId}'::uuid;

              insert into public.custom_settlement_rule_versions (
                id, organization_id, project_id, scope, target_type,
                target_id, execution_grain, composition_mode, priority,
                version_number, status, formula, compiled_ast, variables,
                parameters, rule_contract, system_explanation_template,
                missing_data_policy, test_cases, simulation_summary,
                formula_hash, rule_contract_hash, parameter_hash,
                variable_catalog_version, data_selection_hash,
                simulation_id, effective_from, effective_until, created_by,
                approved_by, ai_draft_id, reason, approved_at, archived_at
              )
              select
                '${versionThreeId}'::uuid,
                version.organization_id,
                version.project_id,
                version.scope,
                version.target_type,
                version.target_id,
                version.execution_grain,
                version.composition_mode,
                version.priority,
                3,
                'archived',
                version.formula,
                version.compiled_ast,
                version.variables,
                version.parameters,
                version.rule_contract,
                version.system_explanation_template,
                version.missing_data_policy,
                version.test_cases,
                version.simulation_summary,
                version.formula_hash,
                version.rule_contract_hash,
                version.parameter_hash,
                version.variable_catalog_version,
                version.data_selection_hash,
                '${simulationThreeId}'::uuid,
                '${overlapStart}'::timestamptz,
                '${overlapEnd}'::timestamptz,
                version.created_by,
                '${actorId}'::uuid,
                null,
                '重叠范围回归',
                '${overlapStart}'::timestamptz,
                '${overlapEnd}'::timestamptz
              from public.custom_settlement_rule_versions as version
              where version.id = '${versionTwoId}'::uuid;
              raise exception 'phase2_overlapping_range_accepted';
            exception
              when exclusion_violation then
                get stacked diagnostics
                  v_constraint_name = constraint_name;
                if v_constraint_name <>
                   'custom_settlement_rule_versions_effective_no_overlap' then
                  raise exception 'phase2_overlap_wrong_constraint: %',
                    v_constraint_name;
                end if;
              when others then
                if sqlerrm = 'phase2_overlapping_range_accepted' then
                  raise;
                end if;
                raise exception 'phase2_overlap_wrong_error: %', sqlerrm;
            end;
            if exists (
              select 1
              from public.custom_settlement_rule_versions
              where id = '${versionThreeId}'::uuid
            ) or exists (
              select 1
              from public.settlement_formula_simulations
              where id = '${simulationThreeId}'::uuid
            ) then
              raise exception 'phase2_overlap_transaction_left_residue';
            end if;
          end;
          $overlap$;
          rollback;
        `,
      );
      expect(runDockerSqlText(container, residueSql)).toBe("0|0|0|t");

      const crossed = await runDockerSqlAsyncCapture(
        container,
        `
          begin;
          ${setupSql}
          ${pairRowsSql(true)}
          set constraints all immediate;
          commit;
        `,
      );
      expect(crossed.code).not.toBe(0);
      expect(crossed.stderr).toContain("23503");
      expect(crossed.stderr).toContain(
        "custom_settlement_rule_versions_simulation_scope_fkey",
      );
      expect(runDockerSqlText(container, residueSql)).toBe("0|0|0|t");
    }, 45_000);

    it("serializes submit and approval while rolling failures back without residue", async () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const actorId = "9f210000-0000-4000-8000-000000000001";
      const financeId = "9f210000-0000-4000-8000-000000000002";
      const organizationId = "9f220000-0000-4000-8000-000000000001";
      const projectId = "9f230000-0000-4000-8000-000000000001";
      const sourceVersionId = "9f240000-0000-4000-8000-000000000001";
      const sourceSimulationId = "9f250000-0000-4000-8000-000000000001";
      const versionAId = "9f240000-0000-4000-8000-000000000002";
      const versionBId = "9f240000-0000-4000-8000-000000000003";
      const simulationAId = "9f250000-0000-4000-8000-000000000002";
      const simulationBId = "9f250000-0000-4000-8000-000000000003";
      const staleVersionId = "9f240000-0000-4000-8000-000000000004";
      const staleSimulationId = "9f250000-0000-4000-8000-000000000004";
      const financeVersionId = "9f240000-0000-4000-8000-000000000005";
      const financeSimulationId = "9f250000-0000-4000-8000-000000000005";
      const fallbackVersionId = "9f240000-0000-4000-8000-000000000006";
      const fallbackSimulationId = "9f250000-0000-4000-8000-000000000006";
      const formulaHash = "c".repeat(64);
      const contractHash = "b".repeat(64);
      const parameterHash = "d".repeat(64);
      const catalogHash = "a".repeat(64);
      const selectionHash = "e".repeat(64);
      const contract = settlementAiCanonicalBusinessContract();
      const compiledAst = { kind: "identifier", name: "grossRevenue" };
      const tests = [
        {
          name: "标准场景",
          inputs: {
            grossRevenue: { type: "money_cents", amountCents: 10_000 },
          },
          expectedResult: { type: "money_cents", amountCents: 10_000 },
        },
      ];
      const simulation = {
        sampleSource: { kind: "historical_settlements" },
        sampleSelection: {
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          populationCount: 20,
          sampledCount: 20,
          criteria: ["confirmed"],
        },
        coverage: {
          summarySchemaVersion: 2,
          totalRecords: 20,
          evaluatedRecords: 20,
          skippedRecords: 0,
          uncoveredRecords: 0,
          zeroAmountRecords: 0,
          reviewRoutedRecords: 0,
          blockedRecords: 0,
        },
        scenarios: [
          {
            id: "contract:000001",
            category: "contract_example",
            outcome: "calculated",
            amountCents: "10000",
            expectedAmountCents: "10000",
            passed: true,
          },
        ],
        historicalTotals: {
          oldPayableAmountCents: null,
          oldReceivableAmountCents: "10000",
          newPayableAmountCents: null,
          newReceivableAmountCents: "10000",
          recordCount: 20,
          verificationStatus: "verified",
        },
        deltas: {
          payableAmountCents: null,
          receivableAmountCents: "0",
          percentageBps: 0,
          marginImpactCents: "0",
        },
        largestChanges: [],
        warnings: [],
      };
      runDockerSql(
        container,
        `
          begin;
          insert into auth.users (id, email) values
            ('${actorId}'::uuid, 'phase2-lifecycle-owner@example.invalid'),
            ('${financeId}'::uuid, 'phase2-lifecycle-finance@example.invalid');
          insert into public.profiles (id, email, full_name) values
            (
              '${actorId}'::uuid,
              'phase2-lifecycle-owner@example.invalid',
              'Phase2 Lifecycle Owner'
            ),
            (
              '${financeId}'::uuid,
              'phase2-lifecycle-finance@example.invalid',
              'Phase2 Lifecycle Finance'
            );
          insert into public.organizations (id, name, code) values (
            '${organizationId}'::uuid,
            'Phase2 Lifecycle',
            'phase2-lifecycle'
          );
          insert into public.organization_members (
            organization_id, user_id, role, status
          ) values
            ('${organizationId}'::uuid, '${actorId}'::uuid, 'owner', 'active'),
            ('${organizationId}'::uuid, '${financeId}'::uuid, 'finance', 'active');
          insert into public.projects (
            id, organization_id, code, name, created_by, owner_id
          ) values (
            '${projectId}'::uuid,
            '${organizationId}'::uuid,
            'phase2-lifecycle',
            'Phase2 Lifecycle',
            '${actorId}'::uuid,
            '${actorId}'::uuid
          );
          insert into public.custom_settlement_rule_versions (
            id, organization_id, project_id, scope, target_type, target_id,
            execution_grain, composition_mode, priority, version_number,
            status, formula, compiled_ast, variables, parameters,
            rule_contract, system_explanation_template, missing_data_policy,
            test_cases, simulation_summary, formula_hash, rule_contract_hash,
            parameter_hash, variable_catalog_version, data_selection_hash,
            simulation_id, created_by
          ) values (
            '${sourceVersionId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'receivable', 'project', null, 'project_period', 'replace', 100, 1,
            'draft', 'grossRevenue', ${sqlJson(compiledAst)}, '[]'::jsonb,
            '{}'::jsonb, ${sqlJson(contract)},
            '项目确认收入作为应收金额。',
            ${sqlJson((contract as { missingDataPolicy: unknown }).missingDataPolicy)},
            ${sqlJson(tests)}, '{}'::jsonb, '${formulaHash}', '${contractHash}',
            '${parameterHash}', '${catalogHash}', '${selectionHash}',
            '${sourceSimulationId}'::uuid, '${actorId}'::uuid
          );
          insert into public.settlement_formula_simulations (
            id, organization_id, project_id, rule_version_id, ai_draft_id,
            formula_hash, rule_contract_hash, parameter_hash,
            variable_catalog_version, data_selection_hash, sample_source,
            sample_selection, coverage, scenarios, historical_totals, deltas,
            largest_changes, warnings, idempotency_key, created_by
          ) values (
            '${sourceSimulationId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${sourceVersionId}'::uuid,
            null,
            '${formulaHash}', '${contractHash}', '${parameterHash}',
            '${catalogHash}', '${selectionHash}',
            ${sqlJson(simulation.sampleSource)},
            ${sqlJson(simulation.sampleSelection)},
            ${sqlJson(simulation.coverage)},
            ${sqlJson(simulation.scenarios)},
            ${sqlJson(simulation.historicalTotals)},
            ${sqlJson(simulation.deltas)},
            ${sqlJson(simulation.largestChanges)},
            ${sqlJson(simulation.warnings)},
            'phase2-lifecycle-source',
            '${actorId}'::uuid
          );
          set constraints all immediate;
          commit;
        `,
      );

      const staleEdit = await runDockerSqlAsyncCapture(
        container,
        `set role authenticated;
         select pg_catalog.set_config(
           'request.jwt.claim.sub', '${actorId}', false
         );
         select public.save_custom_settlement_rule_draft(
           '${organizationId}'::uuid,
           '${projectId}'::uuid,
           null::uuid,
           '${sourceSimulationId}'::uuid,
           '${sourceVersionId}'::uuid,
           '${sourceSimulationId}'::uuid,
           'receivable',
           'project',
           null::uuid,
           ${sqlJson({
             priority: 101,
             formula: "grossRevenue",
             compiledAst,
             variables: [],
             parameters: {},
             ruleContract: contract,
             systemExplanationTemplate: "项目确认收入作为应收金额。",
             missingDataPolicy: (contract as { missingDataPolicy: unknown })
               .missingDataPolicy,
             testCases: tests,
             formulaHash,
             contractHash,
             parameterHash,
             catalogHash,
             dataSelectionHash: selectionHash,
           })},
           'Attempt stale edit',
           'phase2-stale-edit'
         );`,
      );
      expect(staleEdit.code).not.toBe(0);
      expect(staleEdit.stderr).toContain(
        "custom_settlement_rule_draft_hashes_must_change",
      );
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.concat_ws('|',
             (select priority from public.custom_settlement_rule_versions
              where id = '${sourceVersionId}'::uuid),
             (select pg_catalog.count(*)
              from public.custom_settlement_rule_lifecycle_requests
              where client_request_id = 'phase2-stale-edit')
           );`,
        ),
      ).toBe("100|0");

      const applySql = (input: {
        actorId: string;
        requestId: string;
        versionId: string;
        simulationId: string;
        reason?: string;
      }) => `
        set role authenticated;
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${input.actorId}', false
        );
        select public.apply_and_submit_custom_settlement_rule(
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          null::uuid,
          '${sourceVersionId}'::uuid,
          '${sourceSimulationId}'::uuid,
          '${input.versionId}'::uuid,
          '${input.simulationId}'::uuid,
          'receivable',
          'project',
          null::uuid,
          '2026-08-01T00:00:00Z'::timestamptz,
          ${sqlString(input.reason ?? "Submit saved lifecycle draft")},
          'submitted',
          ${sqlString(input.requestId)}
        )::text;
      `;

      const financeDenied = await runDockerSqlAsyncCapture(
        container,
        applySql({
          actorId: financeId,
          requestId: "phase2-finance-denied",
          versionId: financeVersionId,
          simulationId: financeSimulationId,
        }),
      );
      expect(financeDenied.code).not.toBe(0);
      expect(financeDenied.stderr).toContain(
        "custom_settlement_rule_submit_access_denied",
      );
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.count(*) from public.custom_settlement_rule_versions
           where id = '${financeVersionId}'::uuid;`,
        ),
      ).toBe("0");

      const [applyA, applyB] = await Promise.all([
        runDockerSqlAsyncCapture(
          container,
          applySql({
            actorId,
            requestId: "phase2-concurrent-apply-a",
            versionId: versionAId,
            simulationId: simulationAId,
          }),
        ),
        runDockerSqlAsyncCapture(
          container,
          applySql({
            actorId,
            requestId: "phase2-concurrent-apply-b",
            versionId: versionBId,
            simulationId: simulationBId,
          }),
        ),
      ]);
      expect([applyA.code, applyB.code]).toEqual([0, 0]);
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.string_agg(version_number::text, ',' order by version_number)
           from public.custom_settlement_rule_versions
           where id in ('${versionAId}'::uuid, '${versionBId}'::uuid);`,
        ),
      ).toBe("2,3");
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.concat_ws('|',
             (select pg_catalog.count(*) from public.custom_settlement_rule_versions
              where id in ('${versionAId}'::uuid, '${versionBId}'::uuid)),
             (select pg_catalog.count(*) from public.settlement_formula_simulations
              where id in ('${simulationAId}'::uuid, '${simulationBId}'::uuid)),
             (select pg_catalog.count(*) from public.custom_settlement_rule_review_events
              where rule_version_id in ('${versionAId}'::uuid, '${versionBId}'::uuid)
                and event_type = 'submitted')
           );`,
        ),
      ).toBe("2|2|2");

      const replayOne = runDockerSqlText(
        container,
        applySql({
          actorId,
          requestId: "phase2-concurrent-apply-a",
          versionId: versionAId,
          simulationId: simulationAId,
        }),
      );
      const replayTwo = runDockerSqlText(
        container,
        applySql({
          actorId,
          requestId: "phase2-concurrent-apply-a",
          versionId: versionAId,
          simulationId: simulationAId,
        }),
      );
      expect(replayTwo).toBe(replayOne);
      const replayConflict = await runDockerSqlAsyncCapture(
        container,
        applySql({
          actorId,
          requestId: "phase2-concurrent-apply-a",
          versionId: versionAId,
          simulationId: simulationAId,
          reason: "Different payload for the same request key",
        }),
      );
      expect(replayConflict.code).not.toBe(0);
      expect(replayConflict.stderr).toContain(
        "custom_settlement_rule_idempotency_conflict",
      );

      const approveSql = (
        versionId: string,
        requestId: string,
        effectiveFrom: string,
      ) => `
        set role authenticated;
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', false
        );
        select public.review_custom_settlement_rule(
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${versionId}'::uuid,
          'approve',
          '${effectiveFrom}'::timestamptz,
          'Approve atomic lifecycle version',
          null::text,
          false,
          null::text,
          '{}'::jsonb,
          ${sqlString(requestId)}
        )::text;
      `;
      const [approvalA, approvalB] = await Promise.all([
        runDockerSqlAsyncCapture(
          container,
          approveSql(
            versionAId,
            "phase2-concurrent-approve-a",
            "2026-08-01T00:00:00Z",
          ),
        ),
        runDockerSqlAsyncCapture(
          container,
          approveSql(
            versionBId,
            "phase2-concurrent-approve-b",
            "2026-08-01T00:00:00Z",
          ),
        ),
      ]);
      expect(
        [approvalA.code, approvalB.code].filter((code) => code === 0),
      ).toHaveLength(1);
      expect(
        [approvalA, approvalB].find((result) => result.code !== 0)?.stderr,
      ).toContain("custom_settlement_rule_effective_period_conflict");
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.concat_ws('|',
             pg_catalog.count(*) filter (where status = 'active'),
             pg_catalog.count(*) filter (where status = 'pending_review'),
             pg_catalog.count(*) filter (where status = 'archived')
           )
           from public.custom_settlement_rule_versions
           where id in ('${versionAId}'::uuid, '${versionBId}'::uuid);`,
        ),
      ).toBe("1|1|0");

      const pendingVersionId = runDockerSqlText(
        container,
        `select id::text from public.custom_settlement_rule_versions
         where id in ('${versionAId}'::uuid, '${versionBId}'::uuid)
           and status = 'pending_review';`,
      );
      runDockerSql(
        container,
        approveSql(
          pendingVersionId,
          "phase2-replacement-approve",
          "2026-09-01T00:00:00Z",
        ),
      );
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.concat_ws('|',
             pg_catalog.count(*) filter (where status = 'active'),
             pg_catalog.count(*) filter (
               where status = 'archived'
                 and effective_until = '2026-09-01T00:00:00Z'::timestamptz
             )
           )
           from public.custom_settlement_rule_versions
           where id in ('${versionAId}'::uuid, '${versionBId}'::uuid);`,
        ),
      ).toBe("1|1");

      const replayAfterLifecycleChange = runDockerSqlText(
        container,
        applySql({
          actorId,
          requestId: "phase2-concurrent-apply-a",
          versionId: versionAId,
          simulationId: simulationAId,
        }),
      );
      expect(replayAfterLifecycleChange).toBe(replayOne);

      runDockerSql(
        container,
        `update public.custom_settlement_rule_versions
         set data_selection_hash = '${"f".repeat(64)}'
         where id = '${sourceVersionId}'::uuid;`,
      );
      const stale = await runDockerSqlAsyncCapture(
        container,
        applySql({
          actorId,
          requestId: "phase2-stale-rollback",
          versionId: staleVersionId,
          simulationId: staleSimulationId,
        }),
      );
      expect(stale.code).not.toBe(0);
      expect(stale.stderr).toContain("custom_settlement_rule_stale_simulation");
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.concat_ws('|',
             (select pg_catalog.count(*) from public.custom_settlement_rule_versions
              where id = '${staleVersionId}'::uuid),
             (select pg_catalog.count(*) from public.settlement_formula_simulations
              where id = '${staleSimulationId}'::uuid),
             (select pg_catalog.count(*) from public.custom_settlement_rule_review_events
              where rule_version_id = '${staleVersionId}'::uuid)
           );`,
        ),
      ).toBe("0|0|0");

      const active = JSON.parse(
        runDockerSqlText(
          container,
          `select pg_catalog.jsonb_build_object(
             'versionId', id,
             'simulationId', simulation_id
           )::text
           from public.custom_settlement_rule_versions
           where id in ('${versionAId}'::uuid, '${versionBId}'::uuid)
             and status = 'active';`,
        ),
      ) as { versionId: string; simulationId: string };
      runDockerSql(
        container,
        `
          begin;
          insert into public.custom_settlement_rule_versions (
            id, organization_id, project_id, scope, target_type, target_id,
            execution_grain, composition_mode, priority, version_number,
            status, formula, compiled_ast, variables, parameters,
            rule_contract, system_explanation_template, missing_data_policy,
            test_cases, simulation_summary, formula_hash, rule_contract_hash,
            parameter_hash, variable_catalog_version, data_selection_hash,
            simulation_id, created_by, ai_draft_id, reason
          )
          select
            '${fallbackVersionId}'::uuid, organization_id, project_id,
            scope, target_type, target_id, execution_grain, composition_mode,
            priority, 99, 'draft', formula, compiled_ast, variables,
            parameters, rule_contract, system_explanation_template,
            missing_data_policy, test_cases, simulation_summary,
            formula_hash, rule_contract_hash, parameter_hash,
            variable_catalog_version, data_selection_hash,
            '${fallbackSimulationId}'::uuid, '${actorId}'::uuid,
            ai_draft_id, 'Fresh fixed fallback proof'
          from public.custom_settlement_rule_versions
          where id = '${active.versionId}'::uuid;
          insert into public.settlement_formula_simulations (
            id, organization_id, project_id, rule_version_id, ai_draft_id,
            formula_hash, rule_contract_hash, parameter_hash,
            variable_catalog_version, data_selection_hash, sample_source,
            sample_selection, coverage, scenarios, historical_totals, deltas,
            largest_changes, warnings, idempotency_key, created_by
          )
          select
            '${fallbackSimulationId}'::uuid, organization_id, project_id,
            '${fallbackVersionId}'::uuid, null, formula_hash,
            rule_contract_hash, parameter_hash, variable_catalog_version,
            data_selection_hash, sample_source,
            sample_selection || ${sqlJson({
              archiveProof: {
                archivedRuleVersionId: active.versionId,
                proofKind: "fixed_fallback",
                excludesLockedBatches: true,
                lockedBatchCount: 7,
                remainingCustomLayerCount: 0,
                fixedFallbackAvailable: true,
              },
            })}::jsonb,
            coverage, scenarios, historical_totals, deltas, largest_changes,
            warnings, 'phase2-fallback-proof', '${actorId}'::uuid
          from public.settlement_formula_simulations
          where id = '${active.simulationId}'::uuid;
          set constraints all immediate;
          commit;
        `,
      );
      runDockerSql(
        container,
        `set role authenticated;
         select pg_catalog.set_config(
           'request.jwt.claim.sub', '${actorId}', false
         );
         select public.archive_custom_settlement_rule(
           '${organizationId}'::uuid,
           '${projectId}'::uuid,
           '${active.versionId}'::uuid,
           '2026-10-01T00:00:00Z'::timestamptz,
           'Archive with server-owned fixed fallback proof',
           ${sqlJson({
             simulationId: fallbackSimulationId,
             proofKind: "fixed_fallback",
             remainingCustomLayerCount: 0,
             fixedFallbackAvailable: true,
             lockedBatchCount: 7,
             lockedBatchExclusion: {
               excluded: true,
               lockedBatchCount: 7,
             },
           })},
           'phase2-active-archive'
         );`,
      );
      expect(
        runDockerSqlText(
          container,
          `select pg_catalog.concat_ws('|', status, effective_until::text)
           from public.custom_settlement_rule_versions
           where id = '${active.versionId}'::uuid;`,
        ),
      ).toContain("archived|2026-10-01 00:00:00+00");
    }, 60_000);
  },
);

describe.runIf(Boolean(settlementRuntimeRegressionContainer))(
  "Task8 custom settlement runtime database behavior",
  () => {
    it("serializes equal claims without orphan conversations and rejects unsafe callers", async () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const ownerId = "8e110000-0000-4000-8000-000000000001";
      const financeId = "8e110000-0000-4000-8000-000000000002";
      const streamerId = "8e110000-0000-4000-8000-000000000003";
      const organizationId = "8e120000-0000-4000-8000-000000000001";
      const projectId = "8e130000-0000-4000-8000-000000000001";
      const requestId = "task8-concurrent-claim-0001";
      const title = "Task8 Concurrent Claim";
      const requestFingerprint = "a".repeat(64);
      const cleanupSql = `
        delete from public.custom_settlement_ai_sessions
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_conversations
        where organization_id = '${organizationId}'::uuid;
        delete from public.projects
        where organization_id = '${organizationId}'::uuid;
        delete from public.organization_members
        where organization_id = '${organizationId}'::uuid;
        delete from public.organizations
        where id = '${organizationId}'::uuid;
        delete from public.profiles
        where id in (
          '${ownerId}'::uuid,
          '${financeId}'::uuid,
          '${streamerId}'::uuid
        );
        delete from auth.users
        where id in (
          '${ownerId}'::uuid,
          '${financeId}'::uuid,
          '${streamerId}'::uuid
        );
      `;
      const setupSql = `
        ${cleanupSql}
        insert into auth.users (id, email) values
          ('${ownerId}'::uuid, 'task8-claim-owner@example.invalid'),
          ('${financeId}'::uuid, 'task8-claim-finance@example.invalid'),
          ('${streamerId}'::uuid, 'task8-claim-streamer@example.invalid');
        insert into public.profiles (id, email, full_name) values
          (
            '${ownerId}'::uuid,
            'task8-claim-owner@example.invalid',
            'Task8 Claim Owner'
          ),
          (
            '${financeId}'::uuid,
            'task8-claim-finance@example.invalid',
            'Task8 Claim Finance'
          ),
          (
            '${streamerId}'::uuid,
            'task8-claim-streamer@example.invalid',
            'Task8 Claim Streamer'
          );
        insert into public.organizations (id, name, code) values (
          '${organizationId}'::uuid,
          'Task8 Claim Runtime',
          'task8-claim-runtime'
        );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values
          (
            '${organizationId}'::uuid,
            '${ownerId}'::uuid,
            'owner',
            'active'
          ),
          (
            '${organizationId}'::uuid,
            '${financeId}'::uuid,
            'finance',
            'active'
          ),
          (
            '${organizationId}'::uuid,
            '${streamerId}'::uuid,
            'streamer',
            'active'
          );
        insert into public.projects (
          id, organization_id, code, name, created_by, owner_id
        ) values (
          '${projectId}'::uuid,
          '${organizationId}'::uuid,
          'task8-claim-runtime',
          'Task8 Claim Runtime',
          '${ownerId}'::uuid,
          '${ownerId}'::uuid
        );
      `;
      const claimSql = (holdSeconds: number) => `
        begin;
        set local deadlock_timeout = '200ms';
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${ownerId}', true
        );
        select public.claim_custom_settlement_ai_session(
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${requestId}',
          '${title}',
          '${requestFingerprint}'
        );
        select pg_catalog.pg_sleep(${holdSeconds});
        commit;
      `;

      runDockerSql(container, setupSql);
      try {
        const first = runDockerSqlAsyncCapture(container, claimSql(1));
        await new Promise((resolve) => setTimeout(resolve, 200));
        const second = runDockerSqlAsyncCapture(container, claimSql(0));
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(
          [firstResult.stderr, secondResult.stderr].join("\n"),
        ).not.toContain("40P01");
        expect(firstResult.code, firstResult.stderr).toBe(0);
        expect(secondResult.code, secondResult.stderr).toBe(0);

        const resultRows = [firstResult.stdout, secondResult.stdout]
          .flatMap((output) => output.split(/\r?\n/gu))
          .filter((line) => line.trim().startsWith("{"))
          .map(
            (line) =>
              JSON.parse(line) as {
                id: string;
                duplicate: boolean;
              },
          );
        expect(resultRows).toHaveLength(2);
        expect(resultRows.map((row) => row.duplicate).sort()).toEqual([
          false,
          true,
        ]);
        expect(new Set(resultRows.map((row) => row.id)).size).toBe(1);
        for (const row of resultRows) {
          expect(Object.keys(row).sort()).toEqual(
            [
              "created_at",
              "duplicate",
              "id",
              "last_message_at",
              "status",
              "title",
              "updated_at",
            ].sort(),
          );
        }

        expect(
          runDockerSqlText(
            container,
            `
              select
                (
                  select pg_catalog.count(*)
                  from public.custom_settlement_ai_sessions
                  where organization_id = '${organizationId}'::uuid
                )::text || '|' ||
                (
                  select pg_catalog.count(*)
                  from public.ai_conversations
                  where organization_id = '${organizationId}'::uuid
                    and project_id = '${projectId}'::uuid
                )::text;
            `,
          ),
        ).toBe("1|1");

        const mismatch = await runDockerSqlAsyncCapture(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${ownerId}', false
            );
            select public.claim_custom_settlement_ai_session(
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              '${requestId}',
              '${title}',
              '${"b".repeat(64)}'
            );
          `,
        );
        expect(mismatch.code).not.toBe(0);
        expect(mismatch.stderr).toContain(
          "custom_settlement_session_replay_mismatch",
        );

        const titleMismatch = await runDockerSqlAsyncCapture(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${ownerId}', false
            );
            select public.claim_custom_settlement_ai_session(
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              '${requestId}',
              'Task8 Different Replay Title',
              '${requestFingerprint}'
            );
          `,
        );
        expect(titleMismatch.code).not.toBe(0);
        expect(titleMismatch.stderr).toContain(
          "custom_settlement_session_replay_mismatch",
        );

        for (const deniedActorId of [financeId, streamerId]) {
          const denied = await runDockerSqlAsyncCapture(
            container,
            `
              select pg_catalog.set_config(
                'request.jwt.claim.sub', '${deniedActorId}', false
              );
              select public.claim_custom_settlement_ai_session(
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                'task8-denied-claim-0001',
                'Task8 Denied Claim',
                '${requestFingerprint}'
              );
            `,
          );
          expect(denied.code).not.toBe(0);
          expect(denied.stderr).toContain(
            "custom_settlement_session_access_denied",
          );
        }

        const directRead = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${ownerId}', true
            );
            select * from public.custom_settlement_ai_sessions;
            rollback;
          `,
        );
        expect(directRead.code).not.toBe(0);
        expect(directRead.stderr).toContain("permission denied");
      } finally {
        runDockerSql(container, cleanupSql);
      }
    }, 20_000);

    it("returns one bounded finance snapshot while concurrent source writes stay coherent", async () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const ownerId = "8d110000-0000-4000-8000-000000000001";
      const financeId = "8d110000-0000-4000-8000-000000000002";
      const streamerUserId = "8d110000-0000-4000-8000-000000000003";
      const organizationId = "8d120000-0000-4000-8000-000000000001";
      const otherOrganizationId = "8d120000-0000-4000-8000-000000000002";
      const projectId = "8d130000-0000-4000-8000-000000000001";
      const emptyProjectId = "8d130000-0000-4000-8000-000000000002";
      const otherProjectId = "8d130000-0000-4000-8000-000000000003";
      const streamerId = "8d140000-0000-4000-8000-000000000001";
      const projectStreamerId = "8d150000-0000-4000-8000-000000000001";
      const taskId = "8d160000-0000-4000-8000-000000000001";
      const capTaskId = "8d160000-0000-4000-8000-000000000002";
      const reportId = "8d170000-0000-4000-8000-000000000001";
      const secondReportId = "8d170000-0000-4000-8000-000000000002";
      const unrelatedReportId = "8d170000-0000-4000-8000-000000000003";
      const payableBatchId = "8d180000-0000-4000-8000-000000000001";
      const receivableBatchId = "8d180000-0000-4000-8000-000000000002";
      const emptyOverlappingBatchId = "8d180000-0000-4000-8000-000000000003";
      const linkedItemId = "8d190000-0000-4000-8000-000000000001";
      const manualItemId = "8d190000-0000-4000-8000-000000000002";
      const secondLinkedItemId = "8d190000-0000-4000-8000-000000000004";
      const linkedCostId = "8d1a0000-0000-4000-8000-000000000001";
      const unlinkedCostId = "8d1a0000-0000-4000-8000-000000000002";
      const unrelatedCostId = "8d1a0000-0000-4000-8000-000000000003";
      const emptyBatchCostId = "8d1a0000-0000-4000-8000-000000000004";
      const validReportEmptyBatchCostId =
        "8d1a0000-0000-4000-8000-000000000005";
      const unrelatedReportValidBatchCostId =
        "8d1a0000-0000-4000-8000-000000000006";
      const cleanupSql = `
        delete from public.project_cost_items
        where organization_id = '${organizationId}'::uuid;
        delete from public.settlement_batch_items
        where organization_id = '${organizationId}'::uuid;
        delete from public.live_reports
        where organization_id = '${organizationId}'::uuid;
        delete from public.live_tasks
        where organization_id = '${organizationId}'::uuid;
        delete from public.project_streamers
        where organization_id = '${organizationId}'::uuid;
        delete from public.streamers
        where organization_id = '${organizationId}'::uuid;
        delete from public.settlement_batches
        where organization_id = '${organizationId}'::uuid;
        delete from public.custom_settlement_ai_sessions
        where organization_id in (
          '${organizationId}'::uuid,
          '${otherOrganizationId}'::uuid
        );
        delete from public.ai_conversations
        where organization_id in (
          '${organizationId}'::uuid,
          '${otherOrganizationId}'::uuid
        );
        delete from public.projects
        where organization_id in (
          '${organizationId}'::uuid,
          '${otherOrganizationId}'::uuid
        );
        delete from public.organization_members
        where organization_id in (
          '${organizationId}'::uuid,
          '${otherOrganizationId}'::uuid
        );
        delete from public.organizations
        where id in (
          '${organizationId}'::uuid,
          '${otherOrganizationId}'::uuid
        );
        delete from public.profiles
        where id in (
          '${ownerId}'::uuid,
          '${financeId}'::uuid,
          '${streamerUserId}'::uuid
        );
        delete from auth.users
        where id in (
          '${ownerId}'::uuid,
          '${financeId}'::uuid,
          '${streamerUserId}'::uuid
        );
      `;
      const setupSql = `
        ${cleanupSql}
        insert into auth.users (id, email) values
          ('${ownerId}'::uuid, 'task8-snapshot-owner@example.invalid'),
          ('${financeId}'::uuid, 'task8-snapshot-finance@example.invalid'),
          (
            '${streamerUserId}'::uuid,
            'task8-snapshot-streamer@example.invalid'
          );
        insert into public.profiles (id, email, full_name) values
          (
            '${ownerId}'::uuid,
            'task8-snapshot-owner@example.invalid',
            'Task8 Snapshot Owner'
          ),
          (
            '${financeId}'::uuid,
            'task8-snapshot-finance@example.invalid',
            'Task8 Snapshot Finance'
          ),
          (
            '${streamerUserId}'::uuid,
            'task8-snapshot-streamer@example.invalid',
            'Task8 Snapshot Streamer'
          );
        insert into public.organizations (id, name, code) values
          (
            '${organizationId}'::uuid,
            'Task8 Snapshot Runtime',
            'task8-snapshot-runtime'
          ),
          (
            '${otherOrganizationId}'::uuid,
            'Task8 Snapshot Other',
            'task8-snapshot-other'
          );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values
          (
            '${organizationId}'::uuid,
            '${ownerId}'::uuid,
            'owner',
            'active'
          ),
          (
            '${organizationId}'::uuid,
            '${financeId}'::uuid,
            'finance',
            'active'
          ),
          (
            '${organizationId}'::uuid,
            '${streamerUserId}'::uuid,
            'streamer',
            'active'
          ),
          (
            '${otherOrganizationId}'::uuid,
            '${ownerId}'::uuid,
            'owner',
            'active'
          ),
          (
            '${otherOrganizationId}'::uuid,
            '${financeId}'::uuid,
            'finance',
            'active'
          );
        insert into public.projects (
          id, organization_id, code, name, created_by, owner_id
        ) values
          (
            '${projectId}'::uuid,
            '${organizationId}'::uuid,
            'task8-snapshot-source',
            'Task8 Snapshot Source',
            '${ownerId}'::uuid,
            '${ownerId}'::uuid
          ),
          (
            '${emptyProjectId}'::uuid,
            '${organizationId}'::uuid,
            'task8-snapshot-empty',
            'Task8 Snapshot Empty',
            '${ownerId}'::uuid,
            '${ownerId}'::uuid
          ),
          (
            '${otherProjectId}'::uuid,
            '${otherOrganizationId}'::uuid,
            'task8-snapshot-other',
            'Task8 Snapshot Other',
            '${ownerId}'::uuid,
            '${ownerId}'::uuid
          );
        insert into public.streamers (
          id, organization_id, user_id, display_name, source_type, created_by
        ) values (
          '${streamerId}'::uuid,
          '${organizationId}'::uuid,
          '${streamerUserId}'::uuid,
          'Task8 Snapshot Streamer',
          'external',
          '${ownerId}'::uuid
        );
        insert into public.project_streamers (
          id, organization_id, project_id, streamer_id, status, joined_at,
          settlement_method, hourly_rate, base_salary, cps_rate_bps, created_by
        ) values (
          '${projectStreamerId}'::uuid,
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${streamerId}'::uuid,
          'joined',
          '2026-07-01T00:00:00Z'::timestamptz,
          'cpt',
          123.40,
          5000.00,
          1250,
          '${ownerId}'::uuid
        );
        insert into public.live_tasks (
          id, organization_id, project_id, streamer_id, title, status,
          system_started_at, system_stopped_at, system_duration, created_by
        ) values (
          '${taskId}'::uuid,
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${streamerId}'::uuid,
          'Task8 Snapshot Live',
          'completed',
          '2026-07-02T02:00:00Z'::timestamptz,
          '2026-07-02T03:00:00Z'::timestamptz,
          3600,
          '${ownerId}'::uuid
        );
        insert into public.live_reports (
          id, organization_id, live_task_id, project_id, streamer_id, status,
          system_duration, screenshot_duration, settlement_duration,
          time_source, evidence_level, viewers, reviewed_by, reviewed_at,
          created_by
        ) values
          (
            '${reportId}'::uuid,
            '${organizationId}'::uuid,
            '${taskId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            'approved',
            3600,
            3580,
            3600,
            'system',
            'green',
            4200,
            '${ownerId}'::uuid,
            '2026-07-02T04:00:00Z'::timestamptz,
            '${ownerId}'::uuid
          ),
          (
            '${secondReportId}'::uuid,
            '${organizationId}'::uuid,
            '${taskId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            'approved',
            1800,
            1790,
            1800,
            'system',
            'green',
            2100,
            '${ownerId}'::uuid,
            '2026-07-02T05:00:00Z'::timestamptz,
            '${ownerId}'::uuid
          ),
          (
            '${unrelatedReportId}'::uuid,
            '${organizationId}'::uuid,
            '${taskId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            'approved',
            900,
            900,
            900,
            'system',
            'green',
            1000,
            '${ownerId}'::uuid,
            '2026-07-02T06:00:00Z'::timestamptz,
            '${ownerId}'::uuid
          );
        insert into public.settlement_batches (
          id, organization_id, project_id, batch_type, status, period_start,
          period_end, computed_amount, locked_at, created_by, title
        ) values
          (
            '${payableBatchId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'payable',
            'locked',
            '2026-07-01'::date,
            '2026-07-31'::date,
            123.40,
            '2026-08-01T00:00:00Z'::timestamptz,
            '${ownerId}'::uuid,
            'Task8 Payable'
          ),
          (
            '${receivableBatchId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'receivable',
            'locked',
            '2026-07-01'::date,
            '2026-07-31'::date,
            200.00,
            '2026-08-01T00:00:00Z'::timestamptz,
            '${ownerId}'::uuid,
            null
          ),
          (
            '${emptyOverlappingBatchId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'payable',
            'locked',
            '2026-07-02'::date,
            '2026-07-30'::date,
            0.00,
            '2026-08-01T00:00:00Z'::timestamptz,
            '${ownerId}'::uuid,
            'Task8 Empty Overlap'
          );
        insert into public.settlement_batch_items (
          id, organization_id, settlement_batch_id, project_id, streamer_id,
          live_report_id, item_type, computed_amount, evidence_level
        ) values
          (
            '${linkedItemId}'::uuid,
            '${organizationId}'::uuid,
            '${payableBatchId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            '${reportId}'::uuid,
            'live_report',
            123.40,
            'green'
          ),
          (
            '${manualItemId}'::uuid,
            '${organizationId}'::uuid,
            '${receivableBatchId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            null,
            'manual',
            200.00,
            'yellow'
          ),
          (
            '${secondLinkedItemId}'::uuid,
            '${organizationId}'::uuid,
            '${receivableBatchId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            '${secondReportId}'::uuid,
            'live_report',
            61.70,
            'green'
          );
        insert into public.project_cost_items (
          id, organization_id, project_id, streamer_id, live_report_id,
          settlement_batch_id, item_type, amount_cents, direction,
          evidence_level, source, reason, status, created_by, created_at
        ) values
          (
            '${linkedCostId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            '${secondReportId}'::uuid,
            null,
            'manual',
            9007199254740993,
            'cost',
            'green',
            'manual',
            'Task8 linked cost',
            'confirmed',
            '${ownerId}'::uuid,
            '2025-01-01T00:00:00Z'::timestamptz
          ),
          (
            '${unlinkedCostId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            null,
            null,
            'manual',
            42,
            'adjustment',
            'yellow',
            'manual',
            'Task8 fallback cost',
            'confirmed',
            '${ownerId}'::uuid,
            '2026-07-03T00:00:00Z'::timestamptz
          ),
          (
            '${unrelatedCostId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            '${unrelatedReportId}'::uuid,
            null,
            'manual',
            777,
            'cost',
            'green',
            'manual',
            'Task8 unrelated fallback cost',
            'confirmed',
            '${ownerId}'::uuid,
            '2026-07-03T00:00:00Z'::timestamptz
          ),
          (
            '${emptyBatchCostId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            null,
            '${emptyOverlappingBatchId}'::uuid,
            'manual',
            880,
            'cost',
            'green',
            'manual',
            'Task8 empty batch cost',
            'confirmed',
            '${ownerId}'::uuid,
            '2026-07-03T00:00:00Z'::timestamptz
          ),
          (
            '${validReportEmptyBatchCostId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            '${reportId}'::uuid,
            '${emptyOverlappingBatchId}'::uuid,
            'manual',
            881,
            'cost',
            'green',
            'manual',
            'Task8 valid report empty batch cost',
            'confirmed',
            '${ownerId}'::uuid,
            '2026-07-03T00:00:00Z'::timestamptz
          ),
          (
            '${unrelatedReportValidBatchCostId}'::uuid,
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${streamerId}'::uuid,
            '${unrelatedReportId}'::uuid,
            '${payableBatchId}'::uuid,
            'manual',
            882,
            'cost',
            'green',
            'manual',
            'Task8 unrelated report valid batch cost',
            'confirmed',
            '${ownerId}'::uuid,
            '2026-07-03T00:00:00Z'::timestamptz
          );
      `;
      const snapshotCallSql = `
        with evidence as (
          select public.read_custom_settlement_evidence_snapshot(
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            'payable',
            '2026-07-01'::date,
            '2026-07-31'::date,
            'America/St_Johns',
            'confirmed_contract',
            'report',
            10000,
            500
          ) as value
        )
        select pg_catalog.jsonb_build_object(
          'snapshot', evidence.value,
          'hash_valid',
          evidence.value ->> 'snapshot_hash' = pg_catalog.encode(
            extensions.digest(
              (evidence.value - 'snapshot_hash')::text,
              'sha256'
            ),
            'hex'
          )
        )
        from evidence;
      `;

      runDockerSql(container, setupSql);
      try {
        const initialText = runDockerSqlText(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            ${snapshotCallSql}
          `,
        );
        const initialLine = initialText
          .split(/\r?\n/gu)
          .find((line) => line.trim().startsWith("{"));
        expect(initialLine).toBeDefined();
        const initial = JSON.parse(initialLine ?? "null") as {
          hash_valid: boolean;
          snapshot: {
            captured_at: string;
            source_count: number;
            source_counts: {
              live_reports: number;
              live_tasks: number;
              total: number;
            };
            record_count: number;
            settlement_batches: Array<{
              id: string;
              batch_type: string;
              status: string;
              title: string | null;
              version: string;
            }>;
            settlement_batch_items: Array<{
              live_report_id: string | null;
              settlement_batch_id: string;
            }>;
            live_reports: Array<{ id: string; live_task_id: string }>;
            project_cost_items: Array<{
              amount_cents: string;
              live_report_id: string | null;
              settlement_batch_id: string | null;
            }>;
            project_streamers: Array<{
              streamers: { source_type: string };
            }>;
            streamers: Array<{ source_type: string }>;
          };
        };
        expect(initial.hash_valid).toBe(true);
        expect(initial.snapshot.settlement_batches).toHaveLength(3);
        expect(initial.snapshot.settlement_batches).toContainEqual(
          expect.objectContaining({
            id: emptyOverlappingBatchId,
            title: "Task8 Empty Overlap",
          }),
        );
        expect(initial.snapshot.settlement_batch_items).toHaveLength(3);
        expect(
          initial.snapshot.settlement_batch_items.some(
            (item) => item.live_report_id === null,
          ),
        ).toBe(true);
        expect(initial.snapshot.live_reports).toHaveLength(2);
        expect(
          initial.snapshot.live_reports.map((report) => report.id),
        ).not.toContain(unrelatedReportId);
        expect(initial.snapshot.source_counts).toMatchObject({
          live_reports: 2,
          live_tasks: 1,
          total: initial.snapshot.source_count,
        });
        expect(initial.snapshot.record_count).toBe(1);
        expect(
          initial.snapshot.settlement_batches.some(
            (batch) => batch.title === null,
          ),
        ).toBe(true);
        expect(
          initial.snapshot.project_cost_items.map((cost) => cost.amount_cents),
        ).toContain("9007199254740993");
        expect(initial.snapshot.project_cost_items).toContainEqual(
          expect.objectContaining({
            amount_cents: "9007199254740993",
            live_report_id: secondReportId,
          }),
        );
        expect(initial.snapshot.settlement_batch_items).toContainEqual(
          expect.objectContaining({
            live_report_id: secondReportId,
            settlement_batch_id: receivableBatchId,
          }),
        );
        const returnedCostAmounts = initial.snapshot.project_cost_items.map(
          (cost) => cost.amount_cents,
        );
        expect(returnedCostAmounts).toHaveLength(2);
        for (const forbiddenAmount of ["777", "880", "881", "882"]) {
          expect(returnedCostAmounts).not.toContain(forbiddenAmount);
        }

        const routeModule =
          await import("../../features/settlements/custom-rule-route-context");
        const parseSnapshot = (
          routeModule as typeof routeModule & {
            parseCustomSettlementEvidenceSnapshot: (
              data: unknown,
              expected: {
                organizationId: string;
                actorId: string;
                projectId: string;
                scope: "payable" | "receivable";
                periodStart: string;
                periodEnd: string;
                businessTimezone: string;
                businessTimezoneSource:
                  | "contract_default"
                  | "organization_setting"
                  | "confirmed_contract";
                executionGrain:
                  | "report"
                  | "project_streamer_period"
                  | "batch"
                  | "project_period";
                periodStartInclusive: string;
                periodEndExclusive: string;
              },
              now: () => Date,
            ) => unknown;
          }
        ).parseCustomSettlementEvidenceSnapshot;
        expect(
          parseSnapshot(
            initial.snapshot,
            {
              organizationId,
              actorId: financeId,
              projectId,
              scope: "payable",
              periodStart: "2026-07-01",
              periodEnd: "2026-07-31",
              businessTimezone: "America/St_Johns",
              businessTimezoneSource: "confirmed_contract",
              executionGrain: "report",
              periodStartInclusive: "2026-07-01T02:30:00.000Z",
              periodEndExclusive: "2026-08-01T02:30:00.000Z",
            },
            () => new Date(initial.snapshot.captured_at),
          ),
        ).toBeDefined();

        const emptyText = runDockerSqlText(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${emptyProjectId}'::uuid,
              'receivable',
              '2026-07-01'::date,
              '2026-07-31'::date,
              'America/St_Johns',
              'confirmed_contract',
              'project_period',
              10000,
              500
            );
          `,
        );
        const emptyLine = emptyText
          .split(/\r?\n/gu)
          .find((line) => line.trim().startsWith("{"));
        const emptySnapshot = JSON.parse(emptyLine ?? "null") as {
          source_count: number;
          settlement_batches: unknown[];
          project_cost_items: unknown[];
        };
        expect(emptySnapshot.source_count).toBe(0);
        expect(emptySnapshot.settlement_batches).toEqual([]);
        expect(emptySnapshot.project_cost_items).toEqual([]);

        const inclusive366DayText = runDockerSqlText(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${emptyProjectId}'::uuid,
              'payable',
              '2025-01-01'::date,
              '2026-01-01'::date,
              'America/St_Johns',
              'confirmed_contract',
              'project_period',
              10000,
              500
            );
          `,
        );
        const inclusive366DayLine = inclusive366DayText
          .split(/\r?\n/gu)
          .find((line) => line.trim().startsWith("{"));
        const inclusive366DaySnapshot = JSON.parse(
          inclusive366DayLine ?? "null",
        ) as { period_start: string; period_end: string };
        expect(inclusive366DaySnapshot).toMatchObject({
          period_start: "2025-01-01",
          period_end: "2026-01-01",
        });

        const nullScope = await runDockerSqlAsyncCapture(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${emptyProjectId}'::uuid,
              null,
              '2026-07-01'::date,
              '2026-07-31'::date,
              'America/St_Johns',
              'confirmed_contract',
              'project_period',
              10000,
              500
            );
          `,
        );
        expect(nullScope.code).not.toBe(0);
        expect(nullScope.stderr).toContain(
          "custom_settlement_snapshot_scope_invalid",
        );

        const inclusive367Days = await runDockerSqlAsyncCapture(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${emptyProjectId}'::uuid,
              'payable',
              '2025-01-01'::date,
              '2026-01-02'::date,
              'America/St_Johns',
              'confirmed_contract',
              'project_period',
              10000,
              500
            );
          `,
        );
        expect(inclusive367Days.code).not.toBe(0);
        expect(inclusive367Days.stderr).toContain(
          "custom_settlement_snapshot_period_invalid",
        );

        for (const deniedSql of [
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${streamerUserId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              'payable',
              '2026-07-01'::date,
              '2026-07-31'::date,
              'America/St_Johns',
              'confirmed_contract',
              'report',
              10000,
              500
            );
          `,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${otherProjectId}'::uuid,
              'payable',
              '2026-07-01'::date,
              '2026-07-31'::date,
              'America/St_Johns',
              'confirmed_contract',
              'report',
              10000,
              500
            );
          `,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              'payable',
              '2026-07-01'::date,
              '2026-07-31'::date,
              'America/St_Johns',
              'confirmed_contract',
              'report',
              1,
              500
            );
          `,
        ]) {
          const denied = await runDockerSqlAsyncCapture(container, deniedSql);
          expect(denied.code).not.toBe(0);
        }

        const concurrentSnapshot = runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local deadlock_timeout = '200ms';
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', true
            );
            ${snapshotCallSql}
            select pg_catalog.pg_sleep(1.2);
            commit;
          `,
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        const costAttachment = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local deadlock_timeout = '200ms';
            set local lock_timeout = '2s';
            update public.project_cost_items
            set
              amount_cents = amount_cents + 1,
              settlement_batch_id = '${payableBatchId}'::uuid
            where id = '${linkedCostId}'::uuid;
            commit;
          `,
        );
        expect(costAttachment.code, costAttachment.stderr).toBe(0);
        expect(costAttachment.stderr).not.toContain("40P01");
        expect(costAttachment.stderr).not.toContain("55P03");

        const concurrentResult = await concurrentSnapshot;
        expect(concurrentResult.code, concurrentResult.stderr).toBe(0);
        expect(concurrentResult.stderr).not.toContain("40P01");
        const concurrentLine = concurrentResult.stdout
          .split(/\r?\n/gu)
          .find((line) => line.trim().startsWith("{"));
        const concurrent = JSON.parse(
          concurrentLine ?? "null",
        ) as typeof initial;
        expect(concurrent.hash_valid).toBe(true);
        expect(
          concurrent.snapshot.settlement_batches.every(
            (batch) => batch.status === "locked",
          ),
        ).toBe(true);
        const linkedCost = concurrent.snapshot.project_cost_items.find(
          (cost) =>
            cost.amount_cents === "9007199254740993" ||
            cost.amount_cents === "9007199254740994",
        );
        expect(linkedCost).toBeDefined();
        expect([
          linkedCost?.amount_cents,
          linkedCost?.settlement_batch_id,
        ]).toEqual(
          linkedCost?.amount_cents === "9007199254740993"
            ? ["9007199254740993", null]
            : ["9007199254740994", payableBatchId],
        );
        expect(concurrent.snapshot.settlement_batch_items).toHaveLength(3);
        expect(
          concurrent.snapshot.project_streamers.every(
            (row) => row.streamers.source_type === "external",
          ),
        ).toBe(true);
        expect(
          concurrent.snapshot.streamers.every(
            (row) => row.source_type === "external",
          ),
        ).toBe(true);
        expect(
          runDockerSqlText(
            container,
            `
              select amount_cents::text || '|' || settlement_batch_id::text
              from public.project_cost_items
              where id = '${linkedCostId}'::uuid;
            `,
          ),
        ).toBe(`9007199254740994|${payableBatchId}`);

        runDockerSql(
          container,
          `
            insert into public.live_tasks (
              id, organization_id, project_id, streamer_id, title, status,
              system_started_at, system_stopped_at, system_duration, created_by
            ) values (
              '${capTaskId}'::uuid,
              '${organizationId}'::uuid,
              '${emptyProjectId}'::uuid,
              '${streamerId}'::uuid,
              'Task8 Record Cap',
              'completed',
              '2026-07-04T02:00:00Z'::timestamptz,
              '2026-07-04T03:00:00Z'::timestamptz,
              3600,
              '${ownerId}'::uuid
            );
            insert into public.live_reports (
              id, organization_id, live_task_id, project_id, streamer_id,
              status, system_duration, screenshot_duration,
              settlement_duration, time_source, evidence_level, viewers,
              reviewed_by, reviewed_at, created_by
            )
            select
              extensions.gen_random_uuid(),
              '${organizationId}'::uuid,
              '${capTaskId}'::uuid,
              '${emptyProjectId}'::uuid,
              '${streamerId}'::uuid,
              'approved',
              60,
              60,
              60,
              'system',
              'green',
              series.value,
              '${ownerId}'::uuid,
              '2026-07-04T04:00:00Z'::timestamptz,
              '${ownerId}'::uuid
            from pg_catalog.generate_series(1, 501) as series(value);
          `,
        );
        const heldReport = runDockerSqlAsyncCapture(
          container,
          `
            begin;
            select id
            from public.live_reports
            where live_task_id = '${capTaskId}'::uuid
            order by id
            limit 1
            for update;
            select pg_catalog.pg_sleep(1.2);
            commit;
          `,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        const recordLimit = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local lock_timeout = '300ms';
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', true
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${emptyProjectId}'::uuid,
              'payable',
              '2026-07-01'::date,
              '2026-07-31'::date,
              'America/St_Johns',
              'confirmed_contract',
              'report',
              10000,
              500
            );
            commit;
          `,
        );
        expect(recordLimit.code).not.toBe(0);
        expect(recordLimit.stderr).toContain(
          "custom_settlement_snapshot_record_limit_exceeded",
        );
        expect(recordLimit.stderr).not.toContain("55P03");
        expect((await heldReport).code).toBe(0);
      } finally {
        runDockerSql(container, cleanupSql);
      }
    }, 30_000);
  },
);

describe.runIf(Boolean(settlementRuntimeRegressionContainer))(
  "Phase 1 settlement AI authoring authorization PostgreSQL regression",
  () => {
    it("rejects finance authoring while preserving claimed author drafts and finance simulation", async () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const organizationId = "9e120000-0000-4000-8000-000000000001";
      const projectId = "9e130000-0000-4000-8000-000000000001";
      const unclaimedConversationId = "9e140000-0000-4000-8000-000000000099";
      const unclaimedUserMessageId = "9e150000-0000-4000-8000-000000000099";
      const unclaimedAssistantMessageId =
        "9e150000-0000-4000-8000-00000000009a";
      const unclaimedTurnId = "9e160000-0000-4000-8000-000000000099";
      const authorFixtures = [
        {
          id: "9e110000-0000-4000-8000-000000000001",
          role: "owner",
          key: "owner",
          userMessageId: "9e150000-0000-4000-8000-000000000001",
          assistantMessageId: "9e150000-0000-4000-8000-000000000002",
          turnId: "9e160000-0000-4000-8000-000000000001",
        },
        {
          id: "9e110000-0000-4000-8000-000000000002",
          role: "ops_manager",
          key: "ops",
          userMessageId: "9e150000-0000-4000-8000-000000000003",
          assistantMessageId: "9e150000-0000-4000-8000-000000000004",
          turnId: "9e160000-0000-4000-8000-000000000002",
        },
        {
          id: "9e110000-0000-4000-8000-000000000003",
          role: "operator_business",
          key: "operator",
          userMessageId: "9e150000-0000-4000-8000-000000000005",
          assistantMessageId: "9e150000-0000-4000-8000-000000000006",
          turnId: "9e160000-0000-4000-8000-000000000003",
        },
      ] as const;
      const financeId = "9e110000-0000-4000-8000-000000000004";
      const streamerId = "9e110000-0000-4000-8000-000000000005";
      const financeConversationId = "9e140000-0000-4000-8000-000000000004";
      const financeDirectUserMessageId = "9e150000-0000-4000-8000-000000000007";
      const financeDirectAssistantMessageId =
        "9e150000-0000-4000-8000-000000000008";
      const financeDirectTurnId = "9e160000-0000-4000-8000-000000000004";
      const financeAtomicUserMessageId = "9e150000-0000-4000-8000-000000000009";
      const financeAtomicAssistantMessageId =
        "9e150000-0000-4000-8000-00000000000a";
      const financeAtomicTurnId = "9e160000-0000-4000-8000-000000000005";
      const actorIds = [
        ...authorFixtures.map((actor) => actor.id),
        financeId,
        streamerId,
      ];
      const cleanupSql = `
        set session_replication_role = replica;
        delete from public.settlement_formula_simulations
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_settlement_rule_drafts
        where organization_id = '${organizationId}'::uuid;
        set session_replication_role = origin;
        delete from public.custom_settlement_ai_sessions
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_conversations
        where organization_id = '${organizationId}'::uuid;
        delete from public.projects
        where organization_id = '${organizationId}'::uuid;
        delete from public.organization_members
        where organization_id = '${organizationId}'::uuid;
        delete from public.organizations
        where id = '${organizationId}'::uuid;
        delete from public.profiles
        where id in (${actorIds.map((id) => `'${id}'::uuid`).join(", ")});
        delete from auth.users
        where id in (${actorIds.map((id) => `'${id}'::uuid`).join(", ")});
      `;
      const setupSql = `
        ${cleanupSql}
        insert into auth.users (id, email) values
          ${actorIds
            .map(
              (id, index) =>
                `('${id}'::uuid, 'authoring-role-${index + 1}@example.invalid')`,
            )
            .join(",\n          ")};
        insert into public.profiles (id, email, full_name) values
          ${actorIds
            .map(
              (id, index) =>
                `('${id}'::uuid, 'authoring-role-${index + 1}@example.invalid', 'Authoring Role ${index + 1}')`,
            )
            .join(",\n          ")};
        insert into public.organizations (id, name, code) values (
          '${organizationId}'::uuid,
          'Settlement Authoring Role Regression',
          'settlement-authoring-role-regression'
        );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values
          ${[
            ...authorFixtures.map((actor) => ({
              id: actor.id,
              role: actor.role,
            })),
            { id: financeId, role: "finance" },
            { id: streamerId, role: "streamer" },
          ]
            .map(
              (actor) =>
                `('${organizationId}'::uuid, '${actor.id}'::uuid, '${actor.role}', 'active')`,
            )
            .join(",\n          ")};
        insert into public.projects (
          id, organization_id, code, name, created_by, owner_id
        ) values (
          '${projectId}'::uuid,
          '${organizationId}'::uuid,
          'settlement-authoring-role-regression',
          'Settlement Authoring Role Regression',
          '${authorFixtures[0].id}'::uuid,
          '${authorFixtures[0].id}'::uuid
        );
        insert into public.project_assignments (
          organization_id, project_id, user_id
        ) values (
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${authorFixtures[2].id}'::uuid
        );
        insert into public.ai_conversations (
          id, organization_id, owner_user_id, project_id, title
        ) values (
          '${unclaimedConversationId}'::uuid,
          '${organizationId}'::uuid,
          '${authorFixtures[0].id}'::uuid,
          '${projectId}'::uuid,
          'Unclaimed authoring conversation'
        );
      `;

      runDockerSql(container, setupSql);
      try {
        const unclaimedDraftContent = "已生成未绑定 session 的结算规则。";
        const financeDirectDraftContent = "已生成 finance 结算规则。";
        runDockerSql(
          container,
          `
            insert into public.ai_conversations (
              id, organization_id, owner_user_id, project_id, title
            ) values (
              '${financeConversationId}'::uuid,
              '${organizationId}'::uuid,
              '${financeId}'::uuid,
              '${projectId}'::uuid,
              'Finance guard reachability fixture'
            );
            insert into public.custom_settlement_ai_sessions (
              organization_id, project_id, actor_id, client_request_id,
              title, request_fingerprint, conversation_id
            ) values (
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              '${financeId}'::uuid,
              'authoring-role-finance-fixture-0001',
              'Finance guard reachability fixture',
              '${"9".repeat(64)}',
              '${financeConversationId}'::uuid
            );
            insert into public.ai_chat_messages (
              id, organization_id, owner_user_id, conversation_id,
              sequence_no, role, status, content, parent_message_id
            ) values
              (
                '${unclaimedUserMessageId}'::uuid,
                '${organizationId}'::uuid,
                '${authorFixtures[0].id}'::uuid,
                '${unclaimedConversationId}'::uuid,
                1, 'user', 'completed',
                '请生成并确认未绑定 session 的结算规则。', null
              ),
              (
                '${unclaimedAssistantMessageId}'::uuid,
                '${organizationId}'::uuid,
                '${authorFixtures[0].id}'::uuid,
                '${unclaimedConversationId}'::uuid,
                2, 'assistant', 'completed',
                ${sqlString(unclaimedDraftContent)},
                '${unclaimedUserMessageId}'::uuid
              ),
              (
                '${financeDirectUserMessageId}'::uuid,
                '${organizationId}'::uuid,
                '${financeId}'::uuid,
                '${financeConversationId}'::uuid,
                1, 'user', 'completed',
                '请生成 finance 结算规则。', null
              ),
              (
                '${financeDirectAssistantMessageId}'::uuid,
                '${organizationId}'::uuid,
                '${financeId}'::uuid,
                '${financeConversationId}'::uuid,
                2, 'assistant', 'completed',
                ${sqlString(financeDirectDraftContent)},
                '${financeDirectUserMessageId}'::uuid
              ),
              (
                '${financeAtomicUserMessageId}'::uuid,
                '${organizationId}'::uuid,
                '${financeId}'::uuid,
                '${financeConversationId}'::uuid,
                3, 'user', 'completed',
                '请通过 finalizer 生成 finance 结算规则。', null
              ),
              (
                '${financeAtomicAssistantMessageId}'::uuid,
                '${organizationId}'::uuid,
                '${financeId}'::uuid,
                '${financeConversationId}'::uuid,
                4, 'assistant', 'streaming', '',
                '${financeAtomicUserMessageId}'::uuid
              );
            insert into public.ai_chat_turns (
              id, organization_id, owner_user_id, conversation_id,
              user_message_id, assistant_message_id, status,
              idempotency_key, completed_at
            ) values
              (
                '${unclaimedTurnId}'::uuid,
                '${organizationId}'::uuid,
                '${authorFixtures[0].id}'::uuid,
                '${unclaimedConversationId}'::uuid,
                '${unclaimedUserMessageId}'::uuid,
                '${unclaimedAssistantMessageId}'::uuid,
                'completed', 'authoring-role-unclaimed-turn-0001',
                pg_catalog.clock_timestamp()
              ),
              (
                '${financeDirectTurnId}'::uuid,
                '${organizationId}'::uuid,
                '${financeId}'::uuid,
                '${financeConversationId}'::uuid,
                '${financeDirectUserMessageId}'::uuid,
                '${financeDirectAssistantMessageId}'::uuid,
                'completed', 'authoring-role-finance-direct-turn-0001',
                pg_catalog.clock_timestamp()
              );
            insert into public.ai_chat_turns (
              id, organization_id, owner_user_id, conversation_id,
              user_message_id, assistant_message_id, status, idempotency_key
            ) values (
              '${financeAtomicTurnId}'::uuid,
              '${organizationId}'::uuid,
              '${financeId}'::uuid,
              '${financeConversationId}'::uuid,
              '${financeAtomicUserMessageId}'::uuid,
              '${financeAtomicAssistantMessageId}'::uuid,
              'validating', 'authoring-role-finance-atomic-turn-0001'
            );
          `,
        );
        const claimedAuthors = authorFixtures.map((actor) => {
          const clientRequestId = `authoring-role-${actor.key}-claim-0001`;
          runDockerSql(
            container,
            `
              begin;
              set local role authenticated;
              select pg_catalog.set_config(
                'request.jwt.claim.sub', '${actor.id}', true
              );
              select public.claim_custom_settlement_ai_session(
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                '${clientRequestId}',
                'Authoring Role ${actor.key}',
                '${"a".repeat(64)}'
              );
              commit;
            `,
          );
          const conversationId = runDockerSqlText(
            container,
            `
              select conversation_id::text
              from public.custom_settlement_ai_sessions
              where organization_id = '${organizationId}'::uuid
                and project_id = '${projectId}'::uuid
                and actor_id = '${actor.id}'::uuid
                and client_request_id = '${clientRequestId}';
            `,
          );
          return { ...actor, conversationId };
        });
        const draftInputs = claimedAuthors.map((actor) => ({
          actor,
          input: {
            organizationId,
            projectId,
            conversationId: actor.conversationId,
            idempotencyKey: `authoring-role-${actor.key}-draft-0001`,
            promptText: "请生成并确认项目结算规则。",
            turnTrace: {
              turnId: actor.turnId,
              userMessageId: actor.userMessageId,
              assistantMessageId: actor.assistantMessageId,
            },
            businessContract: settlementAiCanonicalBusinessContract(),
            unresolvedAmbiguities: [],
            variableCatalogVersion: "b".repeat(64),
            aiResponse: {
              content: `已生成 ${actor.key} 结算规则。`,
              finishReason: "stop",
              providerRequestId: null,
            },
            generatedFormula: {
              expression: "grossRevenue",
              normalizedAst: { kind: "identifier", name: "grossRevenue" },
            },
            generatedExplanation: "项目确认收入直接作为本周期应收金额。",
            generatedTestCases: [
              {
                name: "标准场景",
                inputs: {
                  grossRevenue: {
                    type: "money_cents",
                    amountCents: 10_000,
                  },
                },
                expectedResult: {
                  type: "money_cents",
                  amountCents: 10_000,
                },
              },
            ],
            model: "authoring-role-regression-model",
            safetyFlags: [],
            contractHash: "c".repeat(64),
            formulaHash: "d".repeat(64),
            parameterHash: "e".repeat(64),
            status: "contract_ready",
          },
        }));
        runDockerSql(
          container,
          draftInputs
            .map(
              ({ actor, input }) => `
                insert into public.ai_chat_messages (
                  id, organization_id, owner_user_id, conversation_id,
                  sequence_no, role, status, content, parent_message_id
                ) values
                  (
                    '${actor.userMessageId}'::uuid,
                    '${organizationId}'::uuid,
                    '${actor.id}'::uuid,
                    '${actor.conversationId}'::uuid,
                    1, 'user', 'completed', '请生成并确认项目结算规则。', null
                  ),
                  (
                    '${actor.assistantMessageId}'::uuid,
                    '${organizationId}'::uuid,
                    '${actor.id}'::uuid,
                    '${actor.conversationId}'::uuid,
                    2, 'assistant', 'completed',
                    ${sqlString(input.aiResponse.content)},
                    '${actor.userMessageId}'::uuid
                  );
                insert into public.ai_chat_turns (
                  id, organization_id, owner_user_id, conversation_id,
                  user_message_id, assistant_message_id, status,
                  idempotency_key, completed_at
                ) values (
                  '${actor.turnId}'::uuid,
                  '${organizationId}'::uuid,
                  '${actor.id}'::uuid,
                  '${actor.conversationId}'::uuid,
                  '${actor.userMessageId}'::uuid,
                  '${actor.assistantMessageId}'::uuid,
                  'completed',
                  'authoring-role-${actor.key}-turn-0001',
                  pg_catalog.clock_timestamp()
                );
              `,
            )
            .join("\n"),
        );

        for (const { actor, input } of draftInputs) {
          const created = await runDockerSqlAsyncCapture(
            container,
            `
              begin;
              set local role authenticated;
              select pg_catalog.set_config(
                'request.jwt.claim.sub', '${actor.id}', true
              );
              ${createDraftRpcSql(input)}
              commit;
            `,
          );
          expect(created.code, created.stderr).toBe(0);
        }

        const ownerDraftInput = draftInputs[0].input;
        const unclaimedDraft = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${authorFixtures[0].id}', true
            );
            ${createDraftRpcSql({
              ...ownerDraftInput,
              conversationId: unclaimedConversationId,
              idempotencyKey: "authoring-role-unclaimed-draft-0001",
              promptText: "请生成并确认未绑定 session 的结算规则。",
              turnTrace: {
                turnId: unclaimedTurnId,
                userMessageId: unclaimedUserMessageId,
                assistantMessageId: unclaimedAssistantMessageId,
              },
              aiResponse: {
                ...ownerDraftInput.aiResponse,
                content: unclaimedDraftContent,
              },
            })}
            commit;
          `,
        );
        expect(unclaimedDraft.code).not.toBe(0);
        expect(unclaimedDraft.stderr).toContain(
          "settlement_ai_authoring_session_required",
        );

        const financeDirectDraftInput = {
          ...ownerDraftInput,
          conversationId: financeConversationId,
          idempotencyKey: "authoring-role-finance-direct-draft-0001",
          promptText: "请生成 finance 结算规则。",
          turnTrace: {
            turnId: financeDirectTurnId,
            userMessageId: financeDirectUserMessageId,
            assistantMessageId: financeDirectAssistantMessageId,
          },
          aiResponse: {
            ...ownerDraftInput.aiResponse,
            content: financeDirectDraftContent,
          },
        };
        const financeDraft = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', true
            );
            ${createDraftRpcSql(financeDirectDraftInput)}
            commit;
          `,
        );
        expect(financeDraft.code).not.toBe(0);
        expect(financeDraft.stderr).toContain(
          "settlement_ai_authoring_role_denied",
        );

        const streamerDraft = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${streamerId}', true
            );
            ${createDraftRpcSql({
              ...financeDirectDraftInput,
              idempotencyKey: "authoring-role-streamer-direct-draft-0001",
            })}
            commit;
          `,
        );
        expect(streamerDraft.code).not.toBe(0);
        expect(streamerDraft.stderr).toContain(
          "settlement_ai_project_access_denied",
        );

        const unauthenticatedInsert = await runDockerSqlAsyncCapture(
          container,
          `
            select pg_catalog.set_config('request.jwt.claim.sub', '', false);
            insert into public.ai_settlement_rule_drafts (
              organization_id, project_id, conversation_id, created_by
            ) values (
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              '${financeConversationId}'::uuid,
              '${financeId}'::uuid
            );
          `,
        );
        expect(unauthenticatedInsert.code).not.toBe(0);
        expect(unauthenticatedInsert.stderr).toContain(
          "settlement_ai_authoring_authentication_required",
        );

        const actorMismatchInsert = await runDockerSqlAsyncCapture(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${authorFixtures[0].id}', false
            );
            insert into public.ai_settlement_rule_drafts (
              organization_id, project_id, conversation_id, created_by
            ) values (
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              '${financeConversationId}'::uuid,
              '${financeId}'::uuid
            );
          `,
        );
        expect(actorMismatchInsert.code).not.toBe(0);
        expect(actorMismatchInsert.stderr).toContain(
          "settlement_ai_authoring_actor_mismatch",
        );

        for (const deniedActorId of [financeId, streamerId]) {
          const deniedInsert = await runDockerSqlAsyncCapture(
            container,
            `
              select pg_catalog.set_config(
                'request.jwt.claim.sub', '${deniedActorId}', false
              );
              insert into public.ai_settlement_rule_drafts (
                organization_id, project_id, conversation_id, created_by
              ) values (
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                '${financeConversationId}'::uuid,
                '${deniedActorId}'::uuid
              );
            `,
          );
          expect(deniedInsert.code).not.toBe(0);
          expect(deniedInsert.stderr).toContain(
            "settlement_ai_authoring_role_denied",
          );
        }

        const financeAtomicDraftInput = {
          ...ownerDraftInput,
          conversationId: financeConversationId,
          idempotencyKey: "authoring-role-finance-atomic-draft-0001",
          promptText: "请通过 finalizer 生成 finance 结算规则。",
          turnTrace: {
            turnId: financeAtomicTurnId,
            userMessageId: financeAtomicUserMessageId,
            assistantMessageId: financeAtomicAssistantMessageId,
          },
          aiResponse: {
            ...ownerDraftInput.aiResponse,
            content: "已通过 finalizer 生成 finance 结算规则。",
          },
        };
        const completion = {
          providerName: "authoring-role-regression-provider",
          content: financeAtomicDraftInput.aiResponse.content,
          aiInvocationId: null,
          metadata: { regression: "authoring_role_gate" },
        };
        const simulation = {
          idempotencyKey: "authoring-role-atomic-simulation-0001",
          dataSelectionHash: "f".repeat(64),
          sampleSource: { kind: "historical_settlements" },
          sampleSelection: {
            periodStart: "2026-06-01",
            periodEnd: "2026-06-30",
            populationCount: 20,
            sampledCount: 20,
            criteria: ["confirmed"],
          },
          coverage: {
            summarySchemaVersion: 2,
            totalRecords: 20,
            evaluatedRecords: 20,
            skippedRecords: 0,
            uncoveredRecords: 0,
            zeroAmountRecords: 0,
            reviewRoutedRecords: 0,
            blockedRecords: 0,
          },
          scenarios: [
            {
              id: "contract:000001",
              category: "contract_example",
              outcome: "calculated",
              amountCents: "10000",
              expectedAmountCents: "10000",
              passed: true,
            },
          ],
          historicalTotals: {
            oldPayableAmountCents: null,
            oldReceivableAmountCents: "10000",
            newPayableAmountCents: null,
            newReceivableAmountCents: "10000",
            recordCount: 20,
            verificationStatus: "verified",
          },
          deltas: {
            payableAmountCents: null,
            receivableAmountCents: "0",
            percentageBps: 0,
            marginImpactCents: "0",
          },
          largestChanges: [],
          warnings: [],
        };
        const failedDraftInput = {
          ...financeAtomicDraftInput,
          idempotencyKey: "authoring-role-failed-finalizer-0001",
          unresolvedAmbiguities: [],
          aiResponse: {
            content: "结算规则生成失败，请稍后重试。",
            finishReason: "stop",
            providerRequestId: null,
          },
          generatedFormula: null,
          generatedExplanation: null,
          generatedTestCases: [],
          formulaHash: null,
          status: "failed",
        };
        const financeFinalizerCalls = [
          `select public.finalize_settlement_ai_draft_turn(
            ${sqlJson(financeAtomicDraftInput)}, ${sqlJson(completion)}
          );`,
          `select public.finalize_settlement_ai_simulation_turn(
            ${sqlJson(financeAtomicDraftInput)},
            ${sqlJson(completion)},
            ${sqlJson(simulation)}
          );`,
          `select public.finalize_settlement_ai_failed_turn(
            ${sqlJson(failedDraftInput)},
            ${sqlJson({ ...completion, content: failedDraftInput.aiResponse.content })},
            'SETTLEMENT_AI_PROVIDER_FAILED',
            ${sqlString(
              SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES.SETTLEMENT_AI_PROVIDER_FAILED,
            )},
            true
          );`,
        ];
        for (const call of financeFinalizerCalls) {
          const deniedFinalizer = await runDockerSqlAsyncCapture(
            container,
            `
              begin;
              set local role authenticated;
              select pg_catalog.set_config(
                'request.jwt.claim.sub', '${financeId}', true
              );
              ${call}
              commit;
            `,
          );
          expect(deniedFinalizer.code).not.toBe(0);
          expect(deniedFinalizer.stderr).toContain(
            "settlement_ai_authoring_role_denied",
          );
        }

        const ownerDraftId = runDockerSqlText(
          container,
          `
            select id::text
            from public.ai_settlement_rule_drafts
            where organization_id = '${organizationId}'::uuid
              and created_by = '${authorFixtures[0].id}'::uuid
              and idempotency_key = '${ownerDraftInput.idempotencyKey}';
          `,
        );
        const financeSimulation = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', true
            );
            ${createSimulationRpcSql({
              organizationId,
              projectId,
              aiDraftId: ownerDraftId,
              idempotencyKey: "authoring-role-finance-simulation-0001",
              formulaHash: ownerDraftInput.formulaHash ?? "",
              ruleContractHash: ownerDraftInput.contractHash,
              parameterHash: ownerDraftInput.parameterHash,
              variableCatalogVersion: ownerDraftInput.variableCatalogVersion,
              dataSelectionHash: simulation.dataSelectionHash,
              sampleSource: simulation.sampleSource,
              sampleSelection: simulation.sampleSelection,
              coverage: simulation.coverage,
              scenarios: simulation.scenarios,
              historicalTotals: simulation.historicalTotals,
              deltas: simulation.deltas,
              largestChanges: simulation.largestChanges,
              warnings: simulation.warnings,
            })}
            commit;
          `,
        );
        expect(financeSimulation.code, financeSimulation.stderr).toBe(0);
        expect(
          runDockerSqlText(
            container,
            `
              select pg_catalog.count(*)::text
              from public.settlement_formula_simulations
              where organization_id = '${organizationId}'::uuid
                and ai_draft_id = '${ownerDraftId}'::uuid
                and created_by = '${financeId}'::uuid;
            `,
          ),
        ).toBe("1");

        const negativeTotalsSimulation = {
          ...simulation,
          idempotencyKey: "authoring-role-negative-total-0001",
          historicalTotals: {
            ...simulation.historicalTotals,
            oldReceivableAmountCents: "-100",
            newReceivableAmountCents: "-50",
          },
          deltas: {
            ...simulation.deltas,
            receivableAmountCents: "50",
            percentageBps: 5_000,
            marginImpactCents: "50",
          },
        };
        const negativeScenarioSimulation = {
          ...simulation,
          idempotencyKey: "authoring-role-negative-scenario-0001",
          scenarios: [
            {
              ...simulation.scenarios[0],
              amountCents: "-1",
              expectedAmountCents: "-1",
            },
          ],
        };
        const coverageGapSimulation = {
          ...simulation,
          idempotencyKey: "authoring-role-coverage-gap-0001",
          coverage: {
            ...simulation.coverage,
            evaluatedRecords: 18,
            skippedRecords: 2,
            reviewRoutedRecords: 0,
            blockedRecords: 1,
          },
        };
        for (const invalid of [
          negativeTotalsSimulation,
          negativeScenarioSimulation,
          coverageGapSimulation,
        ]) {
          expect(
            runDockerSqlText(
              container,
              `
                select public.settlement_ai_simulation_summary_v2_is_valid(
                  '${projectId}'::uuid,
                  ${sqlJson(invalid.sampleSource)},
                  ${sqlJson(invalid.sampleSelection)},
                  ${sqlJson(invalid.coverage)},
                  ${sqlJson(invalid.scenarios)},
                  ${sqlJson(invalid.historicalTotals)},
                  ${sqlJson(invalid.deltas)},
                  ${sqlJson(invalid.largestChanges)},
                  ${sqlJson(invalid.warnings)}
                )::text;
              `,
            ),
          ).toBe("false");
        }

        const negativeRpc = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${financeId}', true
            );
            ${createSimulationRpcSql({
              organizationId,
              projectId,
              aiDraftId: ownerDraftId,
              formulaHash: ownerDraftInput.formulaHash ?? "",
              ruleContractHash: ownerDraftInput.contractHash,
              parameterHash: ownerDraftInput.parameterHash,
              variableCatalogVersion: ownerDraftInput.variableCatalogVersion,
              dataSelectionHash: negativeTotalsSimulation.dataSelectionHash,
              sampleSource: negativeTotalsSimulation.sampleSource,
              sampleSelection: negativeTotalsSimulation.sampleSelection,
              coverage: negativeTotalsSimulation.coverage,
              scenarios: negativeTotalsSimulation.scenarios,
              historicalTotals: negativeTotalsSimulation.historicalTotals,
              deltas: negativeTotalsSimulation.deltas,
              largestChanges: negativeTotalsSimulation.largestChanges,
              warnings: negativeTotalsSimulation.warnings,
              idempotencyKey: negativeTotalsSimulation.idempotencyKey,
            })}
            commit;
          `,
        );
        expect(negativeRpc.code).not.toBe(0);
        expect(negativeRpc.stderr).toContain(
          "settlement_ai_simulation_summary_invalid",
        );
      } finally {
        runDockerSql(container, cleanupSql);
      }
    }, 60_000);
  },
);

describe.runIf(Boolean(settlementRuntimeRegressionContainer))(
  "Phase 1 conversation context PostgreSQL regression",
  () => {
    it("keeps context hashes stable after a real jsonb key-reordering round trip", async () => {
      const container = settlementRuntimeRegressionContainer ?? "";
      const nestedMetadata = {
        longestPropertyName: { zebra: "终", alpha: "始" },
        medium: "中间",
        a: "短",
      };
      const representativeNumbers = [
        0,
        -42,
        123.456,
        1e-7,
        Number.MAX_SAFE_INTEGER,
      ];
      const unicodeMetadata = {
        chinese: "星耀会话",
        emoji: "火箭🚀",
        composed: "café",
      };
      const originalSnapshot = {
        gatewayContext: {
          invocationMetadata: {
            nestedMetadata,
            representativeNumbers,
            unicodeMetadata,
          },
          responseMetadata: {
            retrospectiveDraft: { status: "草稿", score: 9.25 },
            knowledge: { passages: [], source: "知识库" },
            grounding: { beta: 2, alpha: 1 },
          },
          lastUserMessage: "核对 PostgreSQL 冻结上下文 🚀",
          primaryProvider: "deepseek" as const,
          mode: "deep" as const,
          attachments: [],
          messages: [
            { content: "系统规则：保持语义一致", role: "system" as const },
            {
              content: "核对 PostgreSQL 冻结上下文 🚀",
              role: "user" as const,
            },
          ],
        },
        assembledAt: "2026-07-13T00:00:00.000Z",
        groundingRefs: ["dashboard:role-home"],
        messageIds: ["message-user-jsonb"],
        summaryVersion: 7,
        version: 11,
      } satisfies NonNullable<StoredConversationTurn["contextSnapshot"]>;

      const roundTrippedText = runDockerSqlText(
        container,
        `
          create temp table conversation_context_jsonb_round_trip (
            id integer generated always as identity primary key,
            context_snapshot jsonb not null
          );
          insert into conversation_context_jsonb_round_trip (
            context_snapshot
          ) values (${sqlJson(originalSnapshot)});
          select pg_catalog.jsonb_build_object(
            'contextSnapshot', persisted.context_snapshot,
            'isTemporaryTable', (
              select relation.relpersistence = 't'
              from pg_catalog.pg_class as relation
              where relation.oid = pg_catalog.to_regclass(
                'pg_temp.conversation_context_jsonb_round_trip'
              )
            ),
            'persistedRows', (
              select pg_catalog.count(*)
              from pg_temp.conversation_context_jsonb_round_trip
            )
          )::text
          from pg_temp.conversation_context_jsonb_round_trip as persisted;
        `,
      );
      const persistedRoundTrip = JSON.parse(roundTrippedText) as {
        contextSnapshot: typeof originalSnapshot;
        isTemporaryTable: boolean;
        persistedRows: number;
      };

      expect(persistedRoundTrip.isTemporaryTable).toBe(true);
      expect(persistedRoundTrip.persistedRows).toBe(1);
      const roundTrippedSnapshot = persistedRoundTrip.contextSnapshot;

      expect(
        Object.keys(
          roundTrippedSnapshot.gatewayContext.invocationMetadata.nestedMetadata,
        ),
      ).not.toEqual(Object.keys(nestedMetadata));
      expect(roundTrippedSnapshot).toEqual(originalSnapshot);
      expect(
        roundTrippedSnapshot.gatewayContext.invocationMetadata
          .representativeNumbers,
      ).toEqual(representativeNumbers);
      expect(
        roundTrippedSnapshot.gatewayContext.invocationMetadata.unicodeMetadata,
      ).toEqual(unicodeMetadata);

      const contextHashFor = async (
        contextSnapshot: NonNullable<StoredConversationTurn["contextSnapshot"]>,
      ): Promise<string> => {
        let contextHash: string | undefined;
        const turn: StoredConversationTurn = {
          id: "turn-jsonb-round-trip",
          conversationId: "conversation-jsonb-round-trip",
          userMessageId: "message-user-jsonb",
          assistantMessageId: "message-assistant-jsonb",
          mode: "deep",
          status: "accepted",
          attempt: 1,
          contextSnapshot,
          retryOfTurnId: null,
          regenerateOfTurnId: null,
          providerName: null,
          errorCode: null,
          errorSummary: null,
          retryable: true,
        };
        const persistence: ConversationPersistence = {
          createConversation: async () => null,
          listConversations: async () => [],
          getConversation: async () => null,
          listMessages: async () => [],
          listTurns: async () => [turn],
          createTurn: async () => null,
          getTurn: async () => turn,
          transitionTurn: async (input) => {
            contextHash = input.patch?.contextHash;
            return true;
          },
          completeTurn: async () => true,
          failTurn: async () => true,
          renewLease: async () => true,
        };

        await createConversationService(persistence).prepareTurn(
          { organizationId: "org-jsonb", userId: "user-jsonb" },
          turn.id,
        );
        expect(contextHash).toMatch(/^[a-f0-9]{64}$/u);
        return contextHash ?? "";
      };

      const originalHash = await contextHashFor(originalSnapshot);
      const roundTrippedHash = await contextHashFor(roundTrippedSnapshot);

      expect(roundTrippedHash).toBe(originalHash);
    });
  },
);

const settlementAiLockRegressionContainer =
  process.env.SETTLEMENT_AI_DB_LOCK_REGRESSION_CONTAINER;

describe.runIf(Boolean(settlementAiLockRegressionContainer))(
  "Phase 1 settlement AI database lock regression",
  () => {
    it("completes atomic replay beside direct simulation without 40P01", async () => {
      const container = settlementAiLockRegressionContainer ?? "";
      const actorId = "11000000-0000-4000-8000-000000000001";
      const organizationId = "21000000-0000-4000-8000-000000000001";
      const projectId = "31000000-0000-4000-8000-000000000001";
      const conversationId = "41000000-0000-4000-8000-000000000001";
      const userMessageId = "51000000-0000-4000-8000-000000000001";
      const assistantMessageId = "51000000-0000-4000-8000-000000000002";
      const turnId = "61000000-0000-4000-8000-000000000001";
      const draftInput = {
        organizationId,
        projectId,
        conversationId,
        idempotencyKey: "task6-lock-order-draft",
        promptText: "请生成并模拟项目结算规则。",
        turnTrace: { turnId, userMessageId, assistantMessageId },
        businessContract: settlementAiCanonicalBusinessContract(),
        unresolvedAmbiguities: [],
        variableCatalogVersion: "a".repeat(64),
        aiResponse: {
          content: "\n已生成锁顺序回归规则。\n",
          finishReason: "stop",
          providerRequestId: null,
        },
        generatedFormula: {
          expression: "grossRevenue",
          normalizedAst: { kind: "identifier", name: "grossRevenue" },
        },
        generatedExplanation: "项目确认收入直接作为本周期应收金额。",
        generatedTestCases: [
          {
            name: "标准场景",
            inputs: {
              grossRevenue: { type: "money_cents", amountCents: 10_000 },
            },
            expectedResult: { type: "money_cents", amountCents: 10_000 },
          },
        ],
        model: "lock-regression-model",
        safetyFlags: [],
        contractHash: "b".repeat(64),
        formulaHash: "c".repeat(64),
        parameterHash: "d".repeat(64),
        status: "contract_ready",
      };
      const completion = {
        providerName: "lock-regression-provider",
        content: draftInput.aiResponse.content,
        aiInvocationId: null,
        metadata: { regression: "lock_order" },
      };
      const simulation = {
        idempotencyKey: "task6-lock-order-simulation",
        dataSelectionHash: "e".repeat(64),
        sampleSource: { kind: "historical_settlements" },
        sampleSelection: {
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          populationCount: 20,
          sampledCount: 20,
          criteria: ["confirmed"],
        },
        coverage: {
          summarySchemaVersion: 2,
          totalRecords: 20,
          evaluatedRecords: 20,
          skippedRecords: 0,
          uncoveredRecords: 0,
          zeroAmountRecords: 0,
          reviewRoutedRecords: 0,
          blockedRecords: 0,
        },
        scenarios: [
          {
            id: "contract:000001",
            category: "contract_example",
            outcome: "calculated",
            amountCents: "10000",
            expectedAmountCents: "10000",
            passed: true,
          },
        ],
        historicalTotals: {
          oldPayableAmountCents: null,
          oldReceivableAmountCents: "10000",
          newPayableAmountCents: null,
          newReceivableAmountCents: "10000",
          recordCount: 20,
          verificationStatus: "verified",
        },
        deltas: {
          payableAmountCents: null,
          receivableAmountCents: "0",
          percentageBps: 0,
          marginImpactCents: "0",
        },
        largestChanges: [],
        warnings: [],
      };
      const legacySimulation = {
        idempotencyKey: simulation.idempotencyKey,
        dataSelectionHash: simulation.dataSelectionHash,
        sampleSource: simulation.sampleSource,
        sampleSelection: simulation.sampleSelection,
        coverage: {
          totalRecords: 20,
          evaluatedRecords: 20,
          skippedRecords: 0,
        },
        scenarios: [
          { name: "legacy standard", kind: "normal", result: "passed" },
        ],
        historicalTotals: {
          payableAmountCents: null,
          receivableAmountCents: "10000",
          recordCount: 20,
        },
        deltas: {
          payableAmountCents: "0",
          receivableAmountCents: "0",
          percentageBps: 0,
        },
        largestChanges: [],
        warnings: [],
      };
      const draftJson = sqlJson(draftInput);
      const completionJson = sqlJson(completion);
      const simulationJson = sqlJson(simulation);
      const legacySimulationJson = sqlJson(legacySimulation);
      const cleanupSql = `
        set session_replication_role = replica;
        delete from public.settlement_formula_simulations
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_settlement_rule_drafts
        where organization_id = '${organizationId}'::uuid;
        set session_replication_role = origin;
        delete from public.organizations where id = '${organizationId}'::uuid;
        delete from public.profiles where id = '${actorId}'::uuid;
        delete from auth.users where id = '${actorId}'::uuid;
      `;
      const setupSql = `
        ${cleanupSql}
        insert into auth.users (id, email)
        values ('${actorId}'::uuid, 'task6-lock-order@example.invalid');
        insert into public.profiles (id, email, full_name)
        values (
          '${actorId}'::uuid,
          'task6-lock-order@example.invalid',
          'Task6 Lock Order'
        );
        insert into public.organizations (id, name, code)
        values (
          '${organizationId}'::uuid,
          'Task6 Lock Order',
          'task6-lock-order-regression'
        );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values (
          '${organizationId}'::uuid, '${actorId}'::uuid, 'owner', 'active'
        );
        insert into public.projects (
          id, organization_id, code, name, created_by, owner_id
        ) values (
          '${projectId}'::uuid,
          '${organizationId}'::uuid,
          'task6-lock-order-regression',
          'Task6 Lock Order',
          '${actorId}'::uuid,
          '${actorId}'::uuid
        );
        insert into public.ai_conversations (
          id, organization_id, owner_user_id, project_id, title
        ) values (
          '${conversationId}'::uuid,
          '${organizationId}'::uuid,
          '${actorId}'::uuid,
          '${projectId}'::uuid,
          'Task6 Lock Order'
        );
        insert into public.custom_settlement_ai_sessions (
          organization_id, project_id, actor_id, client_request_id,
          title, request_fingerprint, conversation_id
        ) values (
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${actorId}'::uuid,
          'task6-lock-order-session-0001',
          'Task6 Lock Order',
          '${"1".repeat(64)}',
          '${conversationId}'::uuid
        );
        insert into public.ai_chat_messages (
          id, organization_id, owner_user_id, conversation_id, sequence_no,
          role, status, content, parent_message_id
        ) values
          (
            '${userMessageId}'::uuid,
            '${organizationId}'::uuid,
            '${actorId}'::uuid,
            '${conversationId}'::uuid,
            1, 'user', 'completed', '请生成结算规则。', null
          ),
          (
            '${assistantMessageId}'::uuid,
            '${organizationId}'::uuid,
            '${actorId}'::uuid,
            '${conversationId}'::uuid,
            2, 'assistant', 'streaming', '', '${userMessageId}'::uuid
          );
        insert into public.ai_chat_turns (
          id, organization_id, owner_user_id, conversation_id,
          user_message_id, assistant_message_id, status, idempotency_key
        ) values (
          '${turnId}'::uuid,
          '${organizationId}'::uuid,
          '${actorId}'::uuid,
          '${conversationId}'::uuid,
          '${userMessageId}'::uuid,
          '${assistantMessageId}'::uuid,
          'validating',
          'task6-lock-order-turn'
        );
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', false
        );
        select public.finalize_settlement_ai_simulation_turn(
          ${draftJson}, ${completionJson}, ${simulationJson}
        );
      `;
      const directSimulationSql = `
        begin;
        set local deadlock_timeout = '200ms';
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', true
        );
        select id from public.projects
        where id = '${projectId}'::uuid for update;
        select pg_catalog.pg_sleep(2);
        select public.create_settlement_formula_simulation(
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          null,
          (
            select id from public.ai_settlement_rule_drafts
            where organization_id = '${organizationId}'::uuid
              and idempotency_key = 'task6-lock-order-draft'
          ),
          'task6-lock-order-direct-simulation',
          '${"c".repeat(64)}', '${"b".repeat(64)}', '${"d".repeat(64)}',
          '${"a".repeat(64)}', '${"f".repeat(64)}',
          ${sqlJson(simulation.sampleSource)},
          ${sqlJson(simulation.sampleSelection)},
          ${sqlJson(simulation.coverage)},
          ${sqlJson(simulation.scenarios)},
          ${sqlJson(simulation.historicalTotals)},
          ${sqlJson(simulation.deltas)},
          ${sqlJson(simulation.largestChanges)},
          ${sqlJson(simulation.warnings)}
        );
        commit;
      `;
      const atomicReplaySql = `
        begin;
        set local deadlock_timeout = '200ms';
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', true
        );
        select public.finalize_settlement_ai_simulation_turn(
          ${draftJson}, ${completionJson}, ${simulationJson}
        );
        commit;
      `;

      runDockerSql(container, setupSql);
      try {
        const direct = runDockerSqlAsync(container, directSimulationSql);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const replay = runDockerSqlAsync(container, atomicReplaySql);
        const [directResult, replayResult] = await Promise.all([
          direct,
          replay,
        ]);
        expect(
          [directResult.stderr, replayResult.stderr].join("\n"),
        ).not.toContain("40P01");
        expect(directResult.code, directResult.stderr).toBe(0);
        expect(replayResult.code, replayResult.stderr).toBe(0);

        const draftId = runDockerSqlText(
          container,
          `
            select id::text
            from public.ai_settlement_rule_drafts
            where organization_id = '${organizationId}'::uuid
              and idempotency_key = '${draftInput.idempotencyKey}';
          `,
        );
        runDockerSql(
          container,
          `
            set session_replication_role = replica;
            update public.settlement_formula_simulations
            set coverage = ${sqlJson(legacySimulation.coverage)},
                scenarios = ${sqlJson(legacySimulation.scenarios)},
                historical_totals = ${sqlJson(legacySimulation.historicalTotals)},
                deltas = ${sqlJson(legacySimulation.deltas)},
                largest_changes = ${sqlJson(legacySimulation.largestChanges)},
                warnings = ${sqlJson(legacySimulation.warnings)}
            where organization_id = '${organizationId}'::uuid
              and idempotency_key = '${legacySimulation.idempotencyKey}';
            set session_replication_role = origin;
          `,
        );

        const directLegacyReplay = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${actorId}', true
            );
            ${createSimulationRpcSql({
              organizationId,
              projectId,
              aiDraftId: draftId,
              idempotencyKey: legacySimulation.idempotencyKey,
              formulaHash: draftInput.formulaHash ?? "",
              ruleContractHash: draftInput.contractHash,
              parameterHash: draftInput.parameterHash,
              variableCatalogVersion: draftInput.variableCatalogVersion,
              dataSelectionHash: legacySimulation.dataSelectionHash,
              sampleSource: legacySimulation.sampleSource,
              sampleSelection: legacySimulation.sampleSelection,
              coverage: legacySimulation.coverage,
              scenarios: legacySimulation.scenarios,
              historicalTotals: legacySimulation.historicalTotals,
              deltas: legacySimulation.deltas,
              largestChanges: legacySimulation.largestChanges,
              warnings: legacySimulation.warnings,
            })}
            commit;
          `,
        );
        expect(directLegacyReplay.code, directLegacyReplay.stderr).toBe(0);
        expect(directLegacyReplay.stdout).toContain('"duplicate": true');

        const atomicLegacyReplay = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${actorId}', true
            );
            select public.finalize_settlement_ai_simulation_turn(
              ${draftJson}, ${completionJson}, ${legacySimulationJson}
            );
            commit;
          `,
        );
        expect(atomicLegacyReplay.code, atomicLegacyReplay.stderr).toBe(0);
        expect(atomicLegacyReplay.stdout).toContain('"duplicate": true');

        const legacyMismatch = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${actorId}', true
            );
            ${createSimulationRpcSql({
              organizationId,
              projectId,
              aiDraftId: draftId,
              idempotencyKey: legacySimulation.idempotencyKey,
              formulaHash: draftInput.formulaHash ?? "",
              ruleContractHash: draftInput.contractHash,
              parameterHash: draftInput.parameterHash,
              variableCatalogVersion: draftInput.variableCatalogVersion,
              dataSelectionHash: "9".repeat(64),
              sampleSource: legacySimulation.sampleSource,
              sampleSelection: legacySimulation.sampleSelection,
              coverage: legacySimulation.coverage,
              scenarios: legacySimulation.scenarios,
              historicalTotals: legacySimulation.historicalTotals,
              deltas: legacySimulation.deltas,
              largestChanges: legacySimulation.largestChanges,
              warnings: legacySimulation.warnings,
            })}
            commit;
          `,
        );
        expect(legacyMismatch.code).not.toBe(0);
        expect(legacyMismatch.stderr).toContain(
          "settlement_ai_simulation_idempotency_conflict",
        );

        const newLegacyWrite = await runDockerSqlAsyncCapture(
          container,
          `
            begin;
            set local role authenticated;
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${actorId}', true
            );
            ${createSimulationRpcSql({
              organizationId,
              projectId,
              aiDraftId: draftId,
              idempotencyKey: "task6-lock-order-new-v1-simulation",
              formulaHash: draftInput.formulaHash ?? "",
              ruleContractHash: draftInput.contractHash,
              parameterHash: draftInput.parameterHash,
              variableCatalogVersion: draftInput.variableCatalogVersion,
              dataSelectionHash: legacySimulation.dataSelectionHash,
              sampleSource: legacySimulation.sampleSource,
              sampleSelection: legacySimulation.sampleSelection,
              coverage: legacySimulation.coverage,
              scenarios: legacySimulation.scenarios,
              historicalTotals: legacySimulation.historicalTotals,
              deltas: legacySimulation.deltas,
              largestChanges: legacySimulation.largestChanges,
              warnings: legacySimulation.warnings,
            })}
            commit;
          `,
        );
        expect(newLegacyWrite.code).not.toBe(0);
        expect(newLegacyWrite.stderr).toContain(
          "settlement_ai_simulation_summary_v2_required",
        );
      } finally {
        runDockerSql(container, cleanupSql);
      }
    }, 20_000);

    it("completes public draft creation beside atomic replay without FK-lock 40P01", async () => {
      const container = settlementAiLockRegressionContainer ?? "";
      const actorId = "12000000-0000-4000-8000-000000000001";
      const organizationId = "22000000-0000-4000-8000-000000000001";
      const projectId = "32000000-0000-4000-8000-000000000001";
      const conversationId = "42000000-0000-4000-8000-000000000001";
      const userMessageId = "52000000-0000-4000-8000-000000000001";
      const assistantMessageId = "52000000-0000-4000-8000-000000000002";
      const turnId = "62000000-0000-4000-8000-000000000001";
      const draftInput = {
        organizationId,
        projectId,
        conversationId,
        idempotencyKey: "task6-fk-lock-order-draft-1",
        promptText: "请生成需要澄清的项目结算规则。",
        turnTrace: { turnId, userMessageId, assistantMessageId },
        businessContract: settlementAiCanonicalBusinessContract(),
        unresolvedAmbiguities: [
          {
            code: "confirm_rate",
            question: "请确认分成比例。",
            required: true,
          },
        ],
        variableCatalogVersion: "a".repeat(64),
        aiResponse: {
          content: "\n请确认分成比例后继续。\n",
          finishReason: "stop",
          providerRequestId: null,
        },
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        model: "fk-lock-regression-model",
        safetyFlags: [],
        contractHash: "b".repeat(64),
        formulaHash: null,
        parameterHash: "d".repeat(64),
        status: "clarifying",
      };
      const completion = {
        providerName: "fk-lock-regression-provider",
        content: draftInput.aiResponse.content,
        aiInvocationId: null,
        metadata: { regression: "implicit_project_fk_lock" },
      };
      const secondDraftInput = {
        ...draftInput,
        idempotencyKey: "task6-fk-lock-order-draft-2",
      };
      const draftJson = sqlJson(draftInput);
      const completionJson = sqlJson(completion);
      const cleanupSql = `
        set session_replication_role = replica;
        delete from public.settlement_formula_simulations
        where organization_id = '${organizationId}'::uuid;
        delete from public.ai_settlement_rule_drafts
        where organization_id = '${organizationId}'::uuid;
        set session_replication_role = origin;
        delete from public.organizations where id = '${organizationId}'::uuid;
        delete from public.profiles where id = '${actorId}'::uuid;
        delete from auth.users where id = '${actorId}'::uuid;
      `;
      const setupSql = `
        ${cleanupSql}
        insert into auth.users (id, email)
        values ('${actorId}'::uuid, 'task6-fk-lock-order@example.invalid');
        insert into public.profiles (id, email, full_name)
        values (
          '${actorId}'::uuid,
          'task6-fk-lock-order@example.invalid',
          'Task6 FK Lock Order'
        );
        insert into public.organizations (id, name, code)
        values (
          '${organizationId}'::uuid,
          'Task6 FK Lock Order',
          'task6-fk-lock-order-regression'
        );
        insert into public.organization_members (
          organization_id, user_id, role, status
        ) values (
          '${organizationId}'::uuid, '${actorId}'::uuid, 'owner', 'active'
        );
        insert into public.projects (
          id, organization_id, code, name, created_by, owner_id
        ) values (
          '${projectId}'::uuid,
          '${organizationId}'::uuid,
          'task6-fk-lock-order-regression',
          'Task6 FK Lock Order',
          '${actorId}'::uuid,
          '${actorId}'::uuid
        );
        insert into public.ai_conversations (
          id, organization_id, owner_user_id, project_id, title
        ) values (
          '${conversationId}'::uuid,
          '${organizationId}'::uuid,
          '${actorId}'::uuid,
          '${projectId}'::uuid,
          'Task6 FK Lock Order'
        );
        insert into public.custom_settlement_ai_sessions (
          organization_id, project_id, actor_id, client_request_id,
          title, request_fingerprint, conversation_id
        ) values (
          '${organizationId}'::uuid,
          '${projectId}'::uuid,
          '${actorId}'::uuid,
          'task6-fk-lock-order-session-0001',
          'Task6 FK Lock Order',
          '${"2".repeat(64)}',
          '${conversationId}'::uuid
        );
        insert into public.ai_chat_messages (
          id, organization_id, owner_user_id, conversation_id, sequence_no,
          role, status, content, parent_message_id, metadata
        ) values
          (
            '${userMessageId}'::uuid,
            '${organizationId}'::uuid,
            '${actorId}'::uuid,
            '${conversationId}'::uuid,
            1, 'user', 'completed', '请生成结算规则。', null, '{}'::jsonb
          ),
          (
            '${assistantMessageId}'::uuid,
            '${organizationId}'::uuid,
            '${actorId}'::uuid,
            '${conversationId}'::uuid,
            2, 'assistant', 'completed',
            ${sqlString(draftInput.aiResponse.content)},
            '${userMessageId}'::uuid,
            ${sqlJson(completion.metadata)}
          );
        insert into public.ai_chat_turns (
          id, organization_id, owner_user_id, conversation_id,
          user_message_id, assistant_message_id, status, idempotency_key,
          provider_name, retryable, completed_at
        ) values (
          '${turnId}'::uuid,
          '${organizationId}'::uuid,
          '${actorId}'::uuid,
          '${conversationId}'::uuid,
          '${userMessageId}'::uuid,
          '${assistantMessageId}'::uuid,
          'completed',
          'task6-fk-lock-order-turn',
          ${sqlString(completion.providerName)},
          false,
          pg_catalog.clock_timestamp()
        );
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', false
        );
        ${createDraftRpcSql(draftInput)}
      `;
      const parentFirstAtomicSql = `
        begin;
        set local deadlock_timeout = '200ms';
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', true
        );
        select id from public.projects
        where id = '${projectId}'::uuid for update;
        select pg_catalog.pg_sleep(2);
        select public.finalize_settlement_ai_draft_turn(
          ${draftJson}, ${completionJson}
        );
        commit;
      `;
      const publicDraftSql = `
        begin;
        set local deadlock_timeout = '200ms';
        select pg_catalog.set_config(
          'request.jwt.claim.sub', '${actorId}', true
        );
        ${createDraftRpcSql(secondDraftInput)}
        commit;
      `;

      runDockerSql(container, setupSql);
      try {
        const atomic = runDockerSqlAsync(container, parentFirstAtomicSql);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const publicDraft = runDockerSqlAsync(container, publicDraftSql);
        const [atomicResult, publicDraftResult] = await Promise.all([
          atomic,
          publicDraft,
        ]);
        expect(
          [atomicResult.stderr, publicDraftResult.stderr].join("\n"),
        ).not.toContain("40P01");
        expect(atomicResult.code, atomicResult.stderr).toBe(0);
        expect(publicDraftResult.code, publicDraftResult.stderr).toBe(0);
      } finally {
        runDockerSql(container, cleanupSql);
      }
    }, 20_000);

    it.each([
      {
        label: "organization",
        parentRelation: "organizations",
        actorId: "13000000-0000-4000-8000-000000000001",
        organizationId: "23000000-0000-4000-8000-000000000001",
        projectId: "33000000-0000-4000-8000-000000000001",
        conversationId: "43000000-0000-4000-8000-000000000001",
        userMessageId: "53000000-0000-4000-8000-000000000001",
        assistantMessageId: "53000000-0000-4000-8000-000000000002",
        turnId: "63000000-0000-4000-8000-000000000001",
      },
      {
        label: "profile",
        parentRelation: "profiles",
        actorId: "14000000-0000-4000-8000-000000000001",
        organizationId: "24000000-0000-4000-8000-000000000001",
        projectId: "34000000-0000-4000-8000-000000000001",
        conversationId: "44000000-0000-4000-8000-000000000001",
        userMessageId: "54000000-0000-4000-8000-000000000001",
        assistantMessageId: "54000000-0000-4000-8000-000000000002",
        turnId: "64000000-0000-4000-8000-000000000001",
      },
    ])(
      "locks $label before project when public draft creation races a parent writer",
      async ({
        label,
        parentRelation,
        actorId,
        organizationId,
        projectId,
        conversationId,
        userMessageId,
        assistantMessageId,
        turnId,
      }) => {
        const container = settlementAiLockRegressionContainer ?? "";
        const suffix = `task6-${label}-project-lock`;
        const parentId =
          parentRelation === "organizations" ? organizationId : actorId;
        const draftInput = {
          organizationId,
          projectId,
          conversationId,
          idempotencyKey: `${suffix}-draft`,
          promptText: "请生成需要澄清的项目结算规则。",
          turnTrace: { turnId, userMessageId, assistantMessageId },
          businessContract: settlementAiCanonicalBusinessContract(),
          unresolvedAmbiguities: [
            {
              code: "confirm_rate",
              question: "请确认分成比例。",
              required: true,
            },
          ],
          variableCatalogVersion: "a".repeat(64),
          aiResponse: {
            content: "请确认分成比例后继续。",
            finishReason: "stop",
            providerRequestId: null,
          },
          generatedFormula: null,
          generatedExplanation: null,
          generatedTestCases: [],
          model: "parent-lock-regression-model",
          safetyFlags: [],
          contractHash: "b".repeat(64),
          formulaHash: null,
          parameterHash: "d".repeat(64),
          status: "clarifying",
        };
        const cleanupSql = `
          set session_replication_role = replica;
          delete from public.settlement_formula_simulations
          where organization_id = '${organizationId}'::uuid;
          delete from public.ai_settlement_rule_drafts
          where organization_id = '${organizationId}'::uuid;
          set session_replication_role = origin;
          delete from public.organizations where id = '${organizationId}'::uuid;
          delete from public.profiles where id = '${actorId}'::uuid;
          delete from auth.users where id = '${actorId}'::uuid;
        `;
        const setupSql = `
          ${cleanupSql}
          insert into auth.users (id, email)
          values ('${actorId}'::uuid, '${suffix}@example.invalid');
          insert into public.profiles (id, email, full_name)
          values (
            '${actorId}'::uuid,
            '${suffix}@example.invalid',
            'Task6 Parent Lock'
          );
          insert into public.organizations (id, name, code)
          values (
            '${organizationId}'::uuid,
            'Task6 Parent Lock',
            '${suffix}'
          );
          insert into public.organization_members (
            organization_id, user_id, role, status
          ) values (
            '${organizationId}'::uuid, '${actorId}'::uuid, 'owner', 'active'
          );
          insert into public.projects (
            id, organization_id, code, name, created_by, owner_id
          ) values (
            '${projectId}'::uuid,
            '${organizationId}'::uuid,
            '${suffix}',
            'Task6 Parent Lock',
            '${actorId}'::uuid,
            '${actorId}'::uuid
          );
          insert into public.ai_conversations (
            id, organization_id, owner_user_id, project_id, title
          ) values (
            '${conversationId}'::uuid,
            '${organizationId}'::uuid,
            '${actorId}'::uuid,
            '${projectId}'::uuid,
            'Task6 Parent Lock'
          );
          insert into public.custom_settlement_ai_sessions (
            organization_id, project_id, actor_id, client_request_id,
            title, request_fingerprint, conversation_id
          ) values (
            '${organizationId}'::uuid,
            '${projectId}'::uuid,
            '${actorId}'::uuid,
            '${suffix}-session-0001',
            'Task6 Parent Lock',
            '${"3".repeat(64)}',
            '${conversationId}'::uuid
          );
          insert into public.ai_chat_messages (
            id, organization_id, owner_user_id, conversation_id, sequence_no,
            role, status, content, parent_message_id
          ) values
            (
              '${userMessageId}'::uuid,
              '${organizationId}'::uuid,
              '${actorId}'::uuid,
              '${conversationId}'::uuid,
              1, 'user', 'completed', '请生成结算规则。', null
            ),
            (
              '${assistantMessageId}'::uuid,
              '${organizationId}'::uuid,
              '${actorId}'::uuid,
              '${conversationId}'::uuid,
              2, 'assistant', 'completed',
              ${sqlString(draftInput.aiResponse.content)},
              '${userMessageId}'::uuid
            );
          insert into public.ai_chat_turns (
            id, organization_id, owner_user_id, conversation_id,
            user_message_id, assistant_message_id, status, idempotency_key,
            completed_at
          ) values (
            '${turnId}'::uuid,
            '${organizationId}'::uuid,
            '${actorId}'::uuid,
            '${conversationId}'::uuid,
            '${userMessageId}'::uuid,
            '${assistantMessageId}'::uuid,
            'completed',
            '${suffix}-turn',
            pg_catalog.clock_timestamp()
          );
        `;
        const parentWriterSql = `
          begin;
          set local deadlock_timeout = '200ms';
          select id from public.${parentRelation}
          where id = '${parentId}'::uuid for update;
          select pg_catalog.pg_sleep(2);
          select id from public.projects
          where id = '${projectId}'::uuid for update;
          commit;
        `;
        const publicDraftSql = `
          begin;
          set local deadlock_timeout = '200ms';
          select pg_catalog.set_config(
            'request.jwt.claim.sub', '${actorId}', true
          );
          ${createDraftRpcSql(draftInput)}
          commit;
        `;

        runDockerSql(container, setupSql);
        try {
          const parentWriter = runDockerSqlAsync(container, parentWriterSql);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const publicDraft = runDockerSqlAsync(container, publicDraftSql);
          const [parentResult, draftResult] = await Promise.all([
            parentWriter,
            publicDraft,
          ]);
          expect(
            [parentResult.stderr, draftResult.stderr].join("\n"),
          ).not.toContain("40P01");
          expect(parentResult.code, parentResult.stderr).toBe(0);
          expect(draftResult.code, draftResult.stderr).toBe(0);
        } finally {
          runDockerSql(container, cleanupSql);
        }
      },
      20_000,
    );
  },
);

function sqlJson(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`;
}

function sqlString(value: string): string {
  return `$text$${value}$text$`;
}

function createDraftRpcSql(input: {
  organizationId: string;
  projectId: string;
  conversationId: string;
  idempotencyKey: string;
  promptText: string;
  turnTrace: unknown;
  businessContract: unknown;
  unresolvedAmbiguities: unknown;
  variableCatalogVersion: string;
  aiResponse: unknown;
  generatedFormula: unknown | null;
  generatedExplanation: string | null;
  generatedTestCases: unknown;
  model: string;
  safetyFlags: unknown;
  contractHash: string;
  formulaHash: string | null;
  parameterHash: string;
  status: string;
}): string {
  return `
    select public.create_ai_settlement_rule_draft(
      '${input.organizationId}'::uuid,
      '${input.projectId}'::uuid,
      '${input.conversationId}'::uuid,
      ${sqlString(input.idempotencyKey)},
      ${sqlString(input.promptText)},
      ${sqlJson(input.turnTrace)},
      ${sqlJson(input.businessContract)},
      ${sqlJson(input.unresolvedAmbiguities)},
      ${sqlString(input.variableCatalogVersion)},
      ${sqlJson(input.aiResponse)},
      ${input.generatedFormula === null ? "null" : sqlJson(input.generatedFormula)},
      ${input.generatedExplanation === null ? "null" : sqlString(input.generatedExplanation)},
      ${sqlJson(input.generatedTestCases)},
      ${sqlString(input.model)},
      ${sqlJson(input.safetyFlags)},
      ${sqlString(input.contractHash)},
      ${input.formulaHash === null ? "null" : sqlString(input.formulaHash)},
      ${sqlString(input.parameterHash)},
      ${sqlString(input.status)}
    );
  `;
}

function createSimulationRpcSql(input: {
  organizationId: string;
  projectId: string;
  aiDraftId: string;
  idempotencyKey: string;
  formulaHash: string;
  ruleContractHash: string;
  parameterHash: string;
  variableCatalogVersion: string;
  dataSelectionHash: string;
  sampleSource: unknown;
  sampleSelection: unknown;
  coverage: unknown;
  scenarios: unknown;
  historicalTotals: unknown;
  deltas: unknown;
  largestChanges: unknown;
  warnings: unknown;
}): string {
  return `
    select public.create_settlement_formula_simulation(
      '${input.organizationId}'::uuid,
      '${input.projectId}'::uuid,
      null,
      '${input.aiDraftId}'::uuid,
      ${sqlString(input.idempotencyKey)},
      ${sqlString(input.formulaHash)},
      ${sqlString(input.ruleContractHash)},
      ${sqlString(input.parameterHash)},
      ${sqlString(input.variableCatalogVersion)},
      ${sqlString(input.dataSelectionHash)},
      ${sqlJson(input.sampleSource)},
      ${sqlJson(input.sampleSelection)},
      ${sqlJson(input.coverage)},
      ${sqlJson(input.scenarios)},
      ${sqlJson(input.historicalTotals)},
      ${sqlJson(input.deltas)},
      ${sqlJson(input.largestChanges)},
      ${sqlJson(input.warnings)}
    );
  `;
}

function runDockerSql(container: string, sql: string): void {
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
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

function runDockerSqlText(container: string, sql: string): string {
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
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

function runDockerSqlAsyncCapture(
  container: string,
  sql: string,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "exec",
        container,
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

function runDockerSqlAsync(
  container: string,
  sql: string,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "exec",
        container,
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
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}
