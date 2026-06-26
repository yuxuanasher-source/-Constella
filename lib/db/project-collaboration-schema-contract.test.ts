import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260610120000_project_mcn_collaboration_core.sql",
  ),
  "utf8",
).toLowerCase();
const hardeningMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260616120000_harden_project_collaboration_application_integrity.sql",
  ),
  "utf8",
).toLowerCase();

describe("project MCN collaboration schema contract", () => {
  it("adds project collaboration settings fields", () => {
    expect(migration).toContain(
      "add column if not exists is_open_to_mcn_collaboration boolean not null default false",
    );
    expect(migration).toContain(
      "add column if not exists mcn_collaboration_summary text not null default ''",
    );
    expect(migration).toContain(
      "add column if not exists mcn_collaboration_terms jsonb not null default '{}'::jsonb",
    );
  });

  it("creates core collaboration tables with organization and project anchors", () => {
    for (const table of [
      "project_collaboration_shares",
      "project_collaboration_applications",
      "project_collaboration_agreements",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toMatch(
        new RegExp(
          `create table if not exists public\\.${table} \\([\\s\\S]*?project_id uuid not null references public\\.projects\\(id\\)`,
        ),
      );
    }

    expect(migration).toMatch(
      /project_collaboration_shares[\s\S]*owner_organization_id uuid not null references public\.organizations\(id\)/,
    );
    expect(migration).toMatch(
      /project_collaboration_applications[\s\S]*applicant_organization_id uuid not null references public\.organizations\(id\)/,
    );
    expect(migration).toMatch(
      /project_collaboration_agreements[\s\S]*partner_organization_id uuid not null references public\.organizations\(id\)/,
    );
  });

  it("protects basis points, duplicate pending applications, and active agreements", () => {
    expect(migration).toContain(
      "requested_revenue_share_bps between 0 and 10000",
    );
    expect(migration).toContain(
      "owner_counter_revenue_share_bps is null or owner_counter_revenue_share_bps between 0 and 10000",
    );
    expect(migration).toContain(
      "final_revenue_share_bps is null or final_revenue_share_bps between 0 and 10000",
    );
    expect(migration).toContain(
      "project_collaboration_applications_one_pending",
    );
    expect(migration).toContain("project_collaboration_agreements_one_active");
  });

  it("adds RLS helpers and policies for owner and partner access", () => {
    for (const helper of [
      "public.can_access_project_collaboration",
      "public.can_manage_project_collaboration",
      "public.can_contribute_to_project",
    ]) {
      expect(migration).toContain(helper);
    }

    for (const table of [
      "project_collaboration_shares",
      "project_collaboration_applications",
      "project_collaboration_agreements",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(`on public.${table}`);
    }
  });

  it("keeps collaboration application updates owner-managed", () => {
    expect(migration).toContain(
      "project_collaboration_applications_owner_update",
    );
    expect(migration).toContain(
      "public.can_manage_project_collaboration(project_id)",
    );
    expect(migration).not.toContain(
      "or public.is_org_member(applicant_organization_id)",
    );
  });

  it("registers collaboration audit actions", () => {
    for (const action of [
      "create_collaboration_share",
      "revoke_collaboration_share",
      "submit_collaboration_application",
      "review_collaboration_application",
      "confirm_collaboration_counter",
      "activate_collaboration_agreement",
    ]) {
      expect(migration).toContain(`add value if not exists '${action}'`);
    }
  });

  it("hardens collaboration application share/project/owner integrity", () => {
    expect(hardeningMigration).toContain(
      "project_collaboration_shares_id_project_owner_unique",
    );
    expect(hardeningMigration).toContain(
      "unique (id, project_id, owner_organization_id)",
    );
    expect(hardeningMigration).toContain(
      "project_collaboration_applications_share_project_owner_fk",
    );
    expect(hardeningMigration).toContain(
      "foreign key (share_id, project_id, owner_organization_id)",
    );
    expect(hardeningMigration).toContain(
      "references public.project_collaboration_shares (id, project_id, owner_organization_id)",
    );
    expect(hardeningMigration).toContain(
      "project_collaboration_applications_one_open_per_partner",
    );
  });

  it("requires valid active public shares for direct partner application inserts", () => {
    expect(hardeningMigration).toContain(
      "public.can_submit_project_collaboration_application",
    );
    expect(hardeningMigration).toContain(
      "drop policy if exists project_collaboration_applications_partner_insert",
    );
    expect(hardeningMigration).toContain("share.status = 'active'");
    expect(hardeningMigration).toContain("share.expires_at > now()");
    expect(hardeningMigration).toContain("share.allow_applications");
    expect(hardeningMigration).toContain(
      "project.is_open_to_mcn_collaboration",
    );
    expect(hardeningMigration).toContain(
      "public.can_submit_project_collaboration_application(",
    );
  });
});
