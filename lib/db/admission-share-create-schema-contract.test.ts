import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730123000_admission_share_create_rpc.sql",
  ),
  "utf8",
).toLowerCase();

describe("admission share atomic create RPC", () => {
  it("creates the board, selected versions and event in one invoker transaction", () => {
    expect(sql).toContain(
      "create or replace function public.create_admission_share_board",
    );
    expect(sql).toContain("p_mode is null");
    expect(sql).toContain("language plpgsql");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("jsonb_to_recordset");
    expect(sql).toContain("recording_version");
    expect(sql).toContain("mcn_review_decision = 'approved'");
    expect(sql).toContain(
      "external_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'",
    );
    expect(sql).toContain("project_recording_share_items");
    expect(sql).toContain("project_recording_share_events");
    expect(sql).toContain("'created'");
  });

  it("authorizes the authenticated MCN against the project owner organization", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("p_created_by is distinct from auth.uid()");
    expect(sql).toContain("project.organization_id = p_organization_id");
    expect(sql).toContain("public.is_mcn_staff(p_organization_id)");
    expect(sql).toContain("public.can_access_project(p_project_id)");
  });

  it("allows contributor-owned applications and recordings in an MCN-owned project", () => {
    expect(sql).toMatch(
      /recording\.application_id = selected_item\.application_id[\s\S]+recording\.project_id = p_project_id[\s\S]+application\.project_id = p_project_id/u,
    );
    expect(sql).not.toMatch(
      /recording\.organization_id\s*=\s*p_organization_id/u,
    );
    expect(sql).not.toMatch(
      /application\.organization_id\s*=\s*p_organization_id/u,
    );
  });

  it("normalizes expiry, protects formal rounds and grants only authenticated execution", () => {
    expect(sql).toContain("p_expires_at is null");
    expect(sql).toContain("set status = 'expired'");
    expect(sql).toContain("expires_at <= v_now");
    expect(sql).toContain("project_recording_share_boards_one_open_formal_idx");
    expect(sql).toContain("round_number");
    expect(sql).toMatch(
      /revoke all on function public\.create_admission_share_board\([\s\S]+from public, anon/u,
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_admission_share_board\([\s\S]+to authenticated/u,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.create_admission_share_board\([\s\S]+to service_role/u,
    );
  });

  it("defaults formal access codes in the service without forcing them in SQL", () => {
    expect(sql).not.toContain("formal_admission_share_access_code_required");
  });
});
