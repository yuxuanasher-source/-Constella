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

  it("restricts direct board inserts to the authenticated MCN creator", () => {
    expect(sql).toMatch(
      /create policy project_recording_share_boards_authenticated_create_guard\s+on public\.project_recording_share_boards\s+as restrictive\s+for insert\s+to authenticated\s+with check \(\s*public\.is_org_member\(organization_id\)\s+and public\.is_mcn_staff\(organization_id\)\s+and public\.can_access_project\(project_id\)\s+and created_by = auth\.uid\(\)\s*\);/u,
    );
  });

  it("serializes project creation without requiring project UPDATE RLS", () => {
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("pg_catalog.hashtextextended(p_project_id::text, 0)");
    expect(sql).toMatch(
      /from public\.projects as project[\s\S]+project\.organization_id = p_organization_id/u,
    );
    expect(sql).not.toMatch(
      /from public\.projects as project[\s\S]{0,200}for update/u,
    );
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

  it("keeps the insert query alias distinct from the PL/pgSQL loop record", () => {
    expect(sql).toMatch(
      /from jsonb_to_recordset\(p_items\) as payload_item\([\s\S]+join public\.recording_submissions as recording[\s\S]+recording\.id = payload_item\.recording_submission_id[\s\S]+order by payload_item\.sort_order/u,
    );
    expect(sql).not.toMatch(
      /from jsonb_to_recordset\(p_items\) as selected_item\(/u,
    );
  });

  it("grants the project host MCN read-only access to contributor-owned selections", () => {
    expect(sql).toMatch(
      /create policy project_applications_host_mcn_share_read[\s\S]+on public\.project_applications[\s\S]+for select[\s\S]+to authenticated[\s\S]+project\.id = project_applications\.project_id[\s\S]+public\.is_org_member\(project\.organization_id\)[\s\S]+public\.is_mcn_staff\(project\.organization_id\)[\s\S]+public\.can_access_project\(project\.id\)/u,
    );
    expect(sql).toMatch(
      /create policy recording_submissions_host_mcn_share_read[\s\S]+on public\.recording_submissions[\s\S]+for select[\s\S]+to authenticated[\s\S]+project\.id = recording_submissions\.project_id[\s\S]+public\.is_org_member\(project\.organization_id\)[\s\S]+public\.is_mcn_staff\(project\.organization_id\)[\s\S]+public\.can_access_project\(project\.id\)/u,
    );
  });

  it("writes exactly one unforgeable created event from a board trigger", () => {
    expect(sql).not.toContain(
      "create policy project_recording_share_events_staff_insert",
    );
    expect(sql).toContain(
      "create or replace function public.record_admission_share_board_created_event()",
    );
    expect(sql).toMatch(
      /returns trigger[\s\S]+language plpgsql[\s\S]+security definer[\s\S]+set search_path = pg_catalog, public/u,
    );
    expect(sql).toContain(
      "create unique index project_recording_share_events_one_created_idx",
    );
    expect(sql).toMatch(
      /create trigger project_recording_share_boards_record_created_event[\s\S]+after insert on public\.project_recording_share_boards[\s\S]+execute function public\.record_admission_share_board_created_event\(\)/u,
    );
    expect(sql).toContain("'created'");
    expect(sql).toContain("'staff'");
    expect(sql).toContain("new.created_by");
    expect(
      sql.match(/insert into public\.project_recording_share_events/gu),
    ).toHaveLength(1);
    expect(sql).toContain(
      "revoke all on function public.record_admission_share_board_created_event() from public, anon, authenticated",
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
