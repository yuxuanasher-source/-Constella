import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730120000_admission_share_business_workflow.sql",
  ),
  "utf8",
).toLowerCase();

describe("admission share business workflow migration", () => {
  it("freezes the MCN review fact and copies it onto share items", () => {
    expect(migration).toContain(
      "mcn_review_decision public.recording_review_status",
    );
    expect(migration).toContain("mcn_reviewed_by uuid");
    expect(migration).toContain("mcn_reviewed_at timestamptz");
    expect(migration).toContain("mcn_review_note text");
    expect(migration).toContain("guard_recording_mcn_review_fact");
    expect(migration).toContain("recording_mcn_review_fact_is_immutable");
    expect(migration).toMatch(
      /alter table public\.project_recording_share_items[\s\S]+mcn_review_decision public\.recording_review_status/u,
    );
    expect(migration).toContain("mcn_review_decision = 'approved'");
  });

  it("backfills and derives MCN review facts for legacy writers", () => {
    expect(migration).toMatch(
      /update public\.recording_submissions\s+set[\s\S]+mcn_reviewed_at = coalesce\(reviewed_at, updated_at, created_at\)[\s\S]+where status in \('approved', 'rejected', 'needs_changes'\);/u,
    );
    expect(migration).not.toContain("and reviewed_at is not null");
    expect(migration).toMatch(
      /if old\.mcn_review_decision is null[\s\S]+new\.mcn_review_decision is null[\s\S]+new\.status is distinct from old\.status[\s\S]+new\.status in \('approved', 'rejected', 'needs_changes'\)[\s\S]+new\.mcn_review_decision := new\.status[\s\S]+new\.mcn_reviewed_by := new\.reviewed_by[\s\S]+new\.mcn_reviewed_at := coalesce\(\s*new\.reviewed_at,\s*new\.updated_at,\s*new\.created_at\s*\)[\s\S]+new\.mcn_review_note := coalesce\(new\.review_note, ''\)/u,
    );
  });

  it("preserves first-share provenance for legacy shared recordings", () => {
    expect(migration).toMatch(
      /update public\.recording_submissions as recording[\s\S]+mcn_reviewed_at = shared_recordings\.first_shared_at,[\s\S]+mcn_review_note = ''[\s\S]+from shared_recordings/u,
    );
  });

  it("adds board workflow state and versioned vendor review tables", () => {
    expect(migration).toContain("add column mode text,");
    expect(migration).toContain("alter column mode set not null");
    expect(migration).not.toContain(
      "mode text not null default 'formal_review'",
    );
    expect(migration).toContain(
      "review_state text not null default 'not_started'",
    );
    expect(migration).toContain("round_number integer not null default 1");

    for (const table of [
      "project_recording_vendor_review_drafts",
      "project_recording_vendor_review_submissions",
      "project_recording_vendor_review_submission_items",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("keeps board mode and legacy vendor-submit flag consistent", () => {
    expect(migration).toContain(
      "project_recording_share_boards_mode_submit_consistency_check",
    );
    expect(migration).toContain(
      "check (allow_vendor_submit = (mode = 'formal_review'))",
    );
  });

  it("derives workflow fields for current board and share-item writers", () => {
    expect(migration).toContain(
      "create or replace function public.derive_recording_share_board_workflow()",
    );
    expect(migration).toMatch(
      /if new\.mode is null then[\s\S]+new\.mode := case[\s\S]+new\.allow_vendor_submit[\s\S]+'formal_review'[\s\S]+'preview'[\s\S]+end if;[\s\S]+new\.round_number := case[\s\S]+when new\.mode = 'preview' then 0[\s\S]+greatest\(coalesce\(new\.round_number, 1\), 1\)/u,
    );
    expect(migration).toContain(
      "new.allow_vendor_submit := new.mode = 'formal_review'",
    );
    expect(migration).toMatch(
      /create trigger project_recording_share_boards_derive_workflow\s+before insert on public\.project_recording_share_boards[\s\S]+derive_recording_share_board_workflow/u,
    );

    expect(migration).toContain(
      "create or replace function public.prepare_recording_share_item()",
    );
    expect(migration).toMatch(
      /from public\.project_recording_share_boards[\s\S]+from public\.recording_submissions[\s\S]+from public\.project_applications/u,
    );
    expect(migration).toMatch(
      /v_recording\.mcn_review_decision is distinct from\s+'approved'::public\.recording_review_status/u,
    );
    expect(migration).toMatch(
      /v_has_storage :=\s+nullif\(btrim\(v_recording\.storage_path\), ''\) is not null/u,
    );
    expect(migration).toMatch(
      /new\.source_health := case[\s\S]+when v_has_storage and v_has_external[\s\S]+'original_with_external_fallback'[\s\S]+when v_has_storage then 'original_ready'[\s\S]+when v_has_external then 'external_only'/u,
    );
    expect(migration).toContain(
      "recording_share_item_recording_not_mcn_approved",
    );
    expect(migration).toContain("recording_share_item_scope_mismatch");
    expect(migration).toContain("recording_share_item_source_unavailable");
    expect(migration).toContain(
      "new.mcn_review_decision := v_recording.mcn_review_decision",
    );
    expect(migration).toContain(
      "new.allow_external_fallback := v_board.allow_external_fallback",
    );
    expect(migration).toMatch(
      /create trigger project_recording_share_items_prepare\s+before insert on public\.project_recording_share_items[\s\S]+prepare_recording_share_item/u,
    );
  });

  it("keeps MCN share scope separate from contributor recording scope", () => {
    expect(migration).toContain(
      "v_board.organization_id is distinct from new.organization_id",
    );
    expect(migration).toMatch(
      /v_recording\.organization_id is distinct from\s+v_application\.organization_id/u,
    );
    expect(migration).not.toContain(
      "v_recording.organization_id is distinct from new.organization_id",
    );
    expect(migration).not.toContain(
      "v_application.organization_id is distinct from new.organization_id",
    );
    expect(migration).toMatch(
      /v_recording\.application_id is distinct from new\.application_id[\s\S]+v_recording\.version is distinct from new\.recording_version[\s\S]+v_application\.project_id is distinct from new\.project_id/u,
    );
  });

  it("uses the downstream submission item foreign-key name", () => {
    expect(migration).toMatch(
      /create table public\.project_recording_vendor_review_submission_items \([\s\S]+submission_id uuid not null\s+references public\.project_recording_vendor_review_submissions\(id\)/u,
    );
    expect(migration).toContain(
      "unique (submission_id, recording_submission_id)",
    );
    expect(migration).not.toContain("vendor_review_submission_id");
  });

  it("uses source_type for playback issue source classification", () => {
    expect(migration).toMatch(
      /create table public\.project_recording_share_playback_issues \([\s\S]+source_type text not null[\s\S]+check \(source_type in \('original', 'external', 'none'\)\)/u,
    );
  });

  it("allows an empty sanitized user-agent family while limiting its length", () => {
    expect(migration).toContain("check (char_length(user_agent_family) <= 80)");
    expect(migration).not.toContain(
      "check (char_length(user_agent_family) between 1 and 80)",
    );
  });

  it("treats blank storage paths as unavailable during source backfill", () => {
    expect(
      migration.match(
        /nullif\(btrim\(recording\.storage_path\), ''\) is not null/gu,
      ),
    ).toHaveLength(2);
  });

  it("adds RLS-protected events and playback issue reporting", () => {
    for (const table of [
      "project_recording_vendor_review_drafts",
      "project_recording_vendor_review_submissions",
      "project_recording_vendor_review_submission_items",
      "project_recording_share_events",
      "project_recording_share_playback_issues",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toMatch(
        new RegExp(
          `create policy ${table}_staff_read[\\s\\S]+?on public\\.${table}[\\s\\S]+?for select[\\s\\S]+?public\\.is_org_member\\(organization_id\\)[\\s\\S]+?public\\.is_mcn_staff\\(organization_id\\)[\\s\\S]+?public\\.can_access_project\\(project_id\\)`,
          "u",
        ),
      );
    }
    expect(migration).not.toMatch(
      /create policy project_recording_[\s\S]+?for (?:insert|update|all)/u,
    );
  });

  it("validates denormalized scope on every workflow table", () => {
    expect(migration).toContain(
      "create or replace function public.validate_recording_share_workflow_scope()",
    );
    expect(migration).toContain(
      "recording_share_workflow_board_scope_mismatch",
    );
    expect(migration).toContain(
      "recording_share_workflow_submission_item_parent_mismatch",
    );
    expect(migration).toContain(
      "recording_share_workflow_submission_item_share_item_mismatch",
    );
    expect(migration).toContain(
      "recording_share_workflow_playback_recording_mismatch",
    );
    expect(migration).toMatch(
      /from public\.project_recording_share_boards[\s\S]+id = new\.share_board_id[\s\S]+v_board_organization_id is distinct from new\.organization_id[\s\S]+v_board_project_id is distinct from new\.project_id/u,
    );
    expect(migration).toMatch(
      /tg_table_name = 'project_recording_vendor_review_drafts'[\s\S]+from public\.project_recording_share_items[\s\S]+share_board_id = new\.share_board_id[\s\S]+application_id = new\.application_id[\s\S]+recording_submission_id = new\.recording_submission_id[\s\S]+recording_version = new\.recording_version/u,
    );
    expect(migration).toMatch(
      /tg_table_name\s*=\s*'project_recording_vendor_review_submission_items'[\s\S]+from public\.project_recording_vendor_review_submissions[\s\S]+id = new\.submission_id[\s\S]+share_board_id = new\.share_board_id[\s\S]+from public\.project_recording_share_items/u,
    );

    for (const table of [
      "project_recording_vendor_review_drafts",
      "project_recording_vendor_review_submissions",
      "project_recording_vendor_review_submission_items",
      "project_recording_share_events",
      "project_recording_share_playback_issues",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `create constraint trigger ${table}_validate_scope[\\s\\S]+?after insert or update\\s+on public\\.${table}[\\s\\S]+?validate_recording_share_workflow_scope`,
          "u",
        ),
      );
    }
  });

  it("normalizes duplicate formal boards before enforcing uniqueness", () => {
    const expiration = migration.indexOf(
      "update public.project_recording_share_boards\nset status = 'expired'\nwhere status = 'active'\n  and expires_at <= now()",
    );
    const normalization = migration.indexOf("row_number() over");
    const uniqueIndex = migration.indexOf(
      "project_recording_share_boards_one_open_formal_idx",
    );

    expect(expiration).toBeGreaterThanOrEqual(0);
    expect(normalization).toBeGreaterThan(expiration);
    expect(migration).toMatch(
      /row_number\(\) over \(\s*partition by organization_id,\s*project_id\s*order by created_at desc,\s*id desc\s*\)/u,
    );
    expect(uniqueIndex).toBeGreaterThan(normalization);
    expect(migration).toMatch(
      /create unique index project_recording_share_boards_one_open_formal_idx[\s\S]+where mode = 'formal_review'[\s\S]+status = 'active'[\s\S]+locked_at is null/u,
    );
  });
});
