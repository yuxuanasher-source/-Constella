import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260730150000_admission_share_progress_rpc.sql",
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const functionBody =
  sql.match(
    /create or replace function public\.list_admission_share_board_progress\([\s\S]+?\$\$;/u,
  )?.[0] ?? "";

describe("admission share task progress RPC", () => {
  it("exists with a fixed aggregate-only result contract", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(functionBody).toContain(
      "create or replace function public.list_admission_share_board_progress(",
    );
    expect(functionBody).toContain("p_project_ids uuid[]");
    expect(functionBody).toMatch(
      /returns table\s*\(\s*share_board_id uuid,\s*item_count bigint,\s*draft_completed_count bigint\s*\)/u,
    );
  });

  it("uses caller RLS and grants only authenticated server roles", () => {
    expect(functionBody).toContain("security invoker");
    expect(functionBody).not.toContain("security definer");
    expect(functionBody).toContain(
      "public.is_org_member(board.organization_id)",
    );
    expect(functionBody).toContain(
      "public.is_mcn_staff(board.organization_id)",
    );
    expect(functionBody).toContain(
      "public.can_access_project(board.project_id)",
    );
    expect(sql).toMatch(
      /revoke all on function public\.list_admission_share_board_progress\(uuid\[\]\)\s+from public, anon;/u,
    );
    expect(sql).toMatch(
      /grant execute on function public\.list_admission_share_board_progress\(uuid\[\]\)\s+to authenticated, service_role;/u,
    );
  });

  it("counts every item in SQL without a max-rows-limited detail response", () => {
    expect(functionBody).toContain(
      "from public.project_recording_share_boards",
    );
    expect(functionBody).toContain("from public.project_recording_share_items");
    expect(functionBody).toContain(
      "from public.project_recording_vendor_review_drafts",
    );
    expect(functionBody).toContain("count(*)");
    expect(functionBody).not.toContain(" limit ");
    expect(functionBody).not.toContain("recording_submission_id");
  });

  it("matches formal-submit completion semantics including trimmed negative remarks", () => {
    expect(functionBody).toMatch(
      /decision in \(\s*'selected',\s*'backup'\s*\)/u,
    );
    expect(functionBody).toMatch(
      /draft\.decision in \(\s*'rejected',\s*'needs_changes'\s*\)[\s\S]+nullif\(btrim\(draft\.remark\),\s*''\) is not null/u,
    );
    expect(functionBody).not.toMatch(/decision\s*<>\s*'pending'/u);
  });

  it("does not expose share credentials, media locations, or reviewer details", () => {
    expect(functionBody).not.toContain("token_hash");
    expect(functionBody).not.toContain("access_code_hash");
    expect(functionBody).not.toContain("storage_path");
    expect(functionBody).not.toContain("external_url");
    expect(functionBody).not.toContain("reviewer");
    expect(functionBody).not.toContain("contact");
  });
});
