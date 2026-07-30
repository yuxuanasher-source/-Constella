import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260730133000_admission_share_submit_rpc.sql",
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const functionBody =
  sql.match(
    /create or replace function public\.submit_admission_share_review\([\s\S]+?as \$\$[\s\S]+?end;\s*\$\$;/u,
  )?.[0] ?? "";

describe("admission share submit RPC", () => {
  it("is a service-role-only security-definer RPC with the fixed signature", () => {
    expect(functionBody).toContain(
      "create or replace function public.submit_admission_share_review(",
    );
    expect(functionBody).toContain("p_share_board_id uuid");
    expect(functionBody).toContain("p_project_remark text");
    expect(functionBody).toContain("p_submitted_at timestamptz");
    expect(functionBody).toContain("returns jsonb");
    expect(functionBody).toContain("security definer");
    expect(functionBody).not.toContain("auth.uid()");
    expect(sql).toMatch(
      /revoke all on function public\.submit_admission_share_review\([\s\S]+?\) from public, anon, authenticated;/u,
    );
    expect(sql).toMatch(
      /grant execute on function public\.submit_admission_share_review\([\s\S]+?\) to service_role;/u,
    );
  });

  it("locks and validates one active unlocked formal board before mutation", () => {
    expect(functionBody).toContain("for update");
    expect(functionBody).toContain("v_board.mode <> 'formal_review'");
    expect(functionBody).toContain("v_board.status <> 'active'");
    expect(functionBody).toContain("v_board.expires_at <= v_now");
    expect(functionBody).toContain("v_board.revoked_at is not null");
    expect(functionBody).toContain("v_board.locked_at is not null");
    expect(functionBody).toContain("v_board.review_state = 'submitted_locked'");
    expect(functionBody).toContain("admission_share_review_already_locked");
  });

  it("uses only server drafts and rejects incomplete or invalid formal reviews", () => {
    expect(functionBody).toContain(
      "from public.project_recording_vendor_review_drafts",
    );
    expect(functionBody).toContain("admission_share_review_incomplete");
    expect(functionBody).toContain("decision = 'pending'");
    expect(functionBody).toMatch(
      /decision in \(\s*'rejected',\s*'needs_changes'\s*\)[\s\S]+btrim\(remark\) = ''/u,
    );
    expect(functionBody).not.toContain("p_items");
  });

  it("creates an immutable incrementing submission and current vendor read model", () => {
    expect(functionBody).toContain(
      "insert into public.project_recording_vendor_review_submissions",
    );
    expect(functionBody).toContain(
      "insert into public.project_recording_vendor_review_submission_items",
    );
    expect(functionBody).toContain(
      "insert into public.project_recording_vendor_reviews",
    );
    expect(functionBody).toContain("on conflict");
    expect(functionBody).toContain("current_submission_revision + 1");
  });

  it("syncs only the latest non-joined application and keeps stable skip reasons", () => {
    expect(functionBody).toMatch(
      /from public\.recording_submissions[\s\S]+application_id = v_draft\.application_id[\s\S]+version > v_draft\.recording_version/u,
    );
    expect(functionBody).toContain("'superseded_recording_version'");
    expect(functionBody).toContain("'application_already_joined'");
    expect(functionBody).toContain("'recording_approved'");
    expect(functionBody).toContain("'recording_rejected'");
    expect(functionBody).toContain("'recording_required'");
    expect(functionBody).not.toMatch(
      /insert\s+into\s+public\.project_streamers/u,
    );
  });

  it("locks the board, emits submitted evidence, and returns per-item results", () => {
    expect(functionBody).toContain("review_state = 'submitted_locked'");
    expect(functionBody).toContain("locked_at = p_submitted_at");
    expect(functionBody).toContain("last_submitted_at = p_submitted_at");
    expect(functionBody).toContain("'submitted'");
    expect(functionBody).toContain("'submissionrevision'");
    expect(functionBody).toContain("'vendorreviewid'");
    expect(functionBody).toContain("'syncerror'");
  });
});
