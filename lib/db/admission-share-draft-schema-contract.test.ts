import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730130000_admission_share_draft_rpc.sql",
  ),
  "utf8",
).toLowerCase();

const functionBody =
  sql.match(
    /create or replace function public\.save_admission_share_review_draft\([\s\S]+?as \$\$[\s\S]+?end;\s*\$\$;/u,
  )?.[0] ?? "";

describe("admission share draft RPC", () => {
  it("locks and validates the formal share board before writing", () => {
    expect(functionBody).toContain("for update");
    expect(functionBody).toContain("v_board.mode <> 'formal_review'");
    expect(functionBody).toContain("v_board.status <> 'active'");
    expect(functionBody).toContain("v_board.expires_at <= v_now");
    expect(functionBody).toContain("v_board.revoked_at is not null");
    expect(functionBody).toContain("v_board.locked_at is not null");
    expect(functionBody).toContain("v_board.review_state = 'submitted_locked'");
    expect(functionBody).toContain("admission_share_review_already_locked");
  });

  it("binds the draft to an exact share item and applies CAS revisions", () => {
    expect(functionBody).toMatch(
      /from public\.project_recording_share_items[\s\S]+share_board_id = v_board\.id[\s\S]+recording_submission_id = p_recording_submission_id/u,
    );
    expect(functionBody).toContain("p_expected_revision <> 0");
    expect(functionBody).toContain(
      "v_draft.revision is distinct from p_expected_revision",
    );
    expect(functionBody).toContain("admission_share_draft_conflict");
    expect(functionBody).toContain("revision = p_expected_revision + 1");
  });

  it("validates caller-controlled values and the server save timestamp", () => {
    expect(functionBody).toMatch(
      /p_decision not in \(\s*'pending',\s*'selected',\s*'backup',\s*'rejected',\s*'needs_changes'\s*\)/u,
    );
    expect(functionBody).toContain("char_length(p_remark) > 2000");
    expect(functionBody).toContain("cardinality(p_reason_codes) > 20");
    expect(functionBody).toContain("char_length(reason_code) > 64");
    expect(functionBody).toContain("p_saved_at < v_now - interval '5 minutes'");
    expect(functionBody).toContain("p_saved_at > v_now + interval '1 minute'");
  });

  it("updates progress and emits metadata without the remark body", () => {
    expect(functionBody).toContain("review_state = 'in_progress'");
    expect(functionBody).toContain("last_draft_at = p_saved_at");
    expect(functionBody).toContain("'draft_saved'");
    const eventMetadata =
      functionBody.match(
        /jsonb_build_object\([\s\S]+?\)[\s,]+p_saved_at[\s\S]+?return v_draft/u,
      )?.[0] ?? "";
    expect(eventMetadata).toContain("'revision'");
    expect(eventMetadata).not.toContain("p_remark");
  });

  it("is callable only through the server-side service role", () => {
    expect(functionBody).toContain("security definer");
    expect(functionBody).not.toContain("auth.uid()");
    expect(sql).toMatch(
      /revoke all on function public\.save_admission_share_review_draft\([\s\S]+?\) from public, anon, authenticated;/u,
    );
    expect(sql).toMatch(
      /grant execute on function public\.save_admission_share_review_draft\([\s\S]+?\) to service_role;/u,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.save_admission_share_review_draft\([\s\S]+?\) to (?:public|anon|authenticated);/u,
    );
  });
});
