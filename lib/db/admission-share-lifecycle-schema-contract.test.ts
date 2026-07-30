import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730140000_admission_share_lifecycle_rpc.sql",
  ),
  "utf8",
).toLowerCase();

const functionBodies = [
  "extend_admission_share_board",
  "reopen_admission_share_board",
  "rotate_admission_share_board_token",
  "revoke_admission_share_board",
];

describe("admission share lifecycle RPC schema", () => {
  it("defines four security-definer RPCs with explicit actor, project, board, and MCN authorization", () => {
    for (const functionName of functionBodies) {
      expect(sql).toContain(`function public.${functionName}(`);
    }
    expect(sql.match(/security definer/gu)).toHaveLength(4);
    expect(
      sql.match(/p_actor_user_id is distinct from auth\.uid\(\)/gu),
    ).toHaveLength(4);
    expect(
      sql.match(/public\.can_access_project\(p_project_id\)/gu),
    ).toHaveLength(4);
    expect(sql.match(/for update/gu)).toHaveLength(4);
    expect(
      sql.match(/public\.is_mcn_staff\(v_board\.organization_id\)/gu),
    ).toHaveLength(4);
    expect(
      sql.match(
        /project\.id = v_board\.project_id[\s\S]*?project\.organization_id = v_board\.organization_id/gu,
      ),
    ).toHaveLength(4);
  });

  it("bounds extension and restricts reopen to one locked formal round with a real reason", () => {
    expect(sql).toContain("p_expires_at <= v_now");
    expect(sql).toContain("p_expires_at > v_now + interval '30 days'");
    expect(sql).toContain("v_board.mode <> 'formal_review'");
    expect(sql).toContain("v_board.review_state <> 'submitted_locked'");
    expect(sql).toContain("v_board.locked_at is null");
    expect(sql).toContain("char_length(btrim(p_reason)) < 2");
    expect(sql).toContain("project_recording_share_boards_one_open_formal_idx");
    expect(sql).toContain("admission_share_formal_round_already_open");
  });

  it("copies the latest immutable submission into a new draft revision when reopening", () => {
    expect(sql).toMatch(
      /from public\.project_recording_vendor_review_submissions[\s\S]*order by[\s\S]*revision desc[\s\S]*limit 1/gu,
    );
    expect(sql).toContain(
      "delete from public.project_recording_vendor_review_drafts",
    );
    expect(sql).toContain(
      "insert into public.project_recording_vendor_review_drafts",
    );
    expect(sql).toContain(
      "from public.project_recording_vendor_review_submission_items",
    );
    expect(sql).toContain("v_submission.revision + 1");
  });

  it("atomically invalidates old tokens, sessions, and attempts and writes lifecycle evidence", () => {
    expect(
      sql.match(
        /delete from public\.project_recording_share_access_sessions/gu,
      ),
    ).toHaveLength(2);
    expect(
      sql.match(
        /delete from public\.project_recording_share_access_attempts/gu,
      ),
    ).toHaveLength(2);
    expect(sql).toContain("set token_hash = p_token_hash");
    expect(sql).toContain("extensions.gen_random_bytes(32)");
    for (const eventType of [
      "extended",
      "reopened",
      "token_rotated",
      "revoked",
    ]) {
      expect(sql).toContain(`'${eventType}'`);
    }
  });

  it("grants lifecycle execution only to authenticated users", () => {
    for (const functionName of functionBodies) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]*?\\) from public, anon, authenticated;[\\s\\S]*?grant execute on function public\\.${functionName}\\([\\s\\S]*?\\) to authenticated;`,
          "u",
        ),
      );
    }
    expect(sql).not.toMatch(/\) to (?:public|anon|service_role);/u);
  });
});
