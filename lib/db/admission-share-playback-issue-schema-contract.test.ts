import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730143000_admission_share_playback_issue_rpc.sql",
  ),
  "utf8",
).toLowerCase();

describe("admission share playback issue RPC schema", () => {
  it("reports one shared-recording issue and its event atomically", () => {
    expect(sql).toContain(
      "create or replace function public.report_admission_share_playback_issue",
    );
    expect(sql).toMatch(
      /report_admission_share_playback_issue[\s\S]+security definer[\s\S]+join public\.project_recording_share_items[\s\S]+board\.status = 'active'[\s\S]+board\.expires_at > v_now/u,
    );
    expect(sql).toMatch(
      /insert into public\.project_recording_share_playback_issues[\s\S]+insert into public\.project_recording_share_events[\s\S]+'playback_issue_reported'/u,
    );
    const reportGrants =
      sql.match(
        /grant execute on function public\.report_admission_share_playback_issue\([\s\S]*?\) to [^;]+;/gu,
      ) ?? [];
    expect(reportGrants).toHaveLength(1);
    expect(reportGrants[0]).toContain("to service_role");
    expect(reportGrants[0]).not.toMatch(/\b(?:anon|authenticated)\b/u);
  });

  it("keeps public payloads bounded to issue enums and browser families", () => {
    for (const value of [
      "media_load_failed",
      "media_decode_failed",
      "external_link_failed",
      "no_playable_source",
      "'original'",
      "'external'",
      "'none'",
    ]) {
      expect(sql).toContain(value);
    }
    expect(sql).toContain("char_length(p_user_agent_family) > 40");
    expect(sql).not.toMatch(
      /jsonb_build_object\([\s\S]*?(?:token|access_code|storage_path|ip_address|user_agent_family)/u,
    );
  });

  it("resolves idempotently under a row lock with authenticated MCN scope", () => {
    expect(sql).toContain(
      "create or replace function public.resolve_admission_share_playback_issue",
    );
    expect(sql).toMatch(
      /resolve_admission_share_playback_issue[\s\S]+auth\.uid\(\) is null[\s\S]+p_actor_user_id is distinct from auth\.uid\(\)[\s\S]+public\.is_org_member\(p_organization_id\)[\s\S]+public\.is_mcn_staff\(p_organization_id\)[\s\S]+public\.can_access_project\(p_project_id\)/u,
    );
    expect(sql).toMatch(
      /where id = p_issue_id[\s\S]+organization_id = p_organization_id[\s\S]+project_id = p_project_id[\s\S]+for update/u,
    );
    expect(sql).toMatch(
      /if v_issue\.status = 'resolved' then[\s\S]+return v_issue/u,
    );
    expect(sql).toMatch(
      /set\s+status = 'resolved',\s+resolved_by = p_actor_user_id,\s+resolved_at = p_resolved_at/u,
    );
    expect(sql).toContain("'playback_issue_resolved'");
    expect(sql).toMatch(
      /grant execute on function public\.resolve_admission_share_playback_issue\([\s\S]+to authenticated/u,
    );
    expect(sql).toContain("if p_resolved_at is null then");
  });

  it("does not create a general playback-issue update policy", () => {
    expect(sql).not.toMatch(
      /create policy[\s\S]+on public\.project_recording_share_playback_issues[\s\S]+for update/u,
    );
    expect(sql).not.toContain("resolution_note =");
  });
});
