import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("allows business operators to read project drafts they created", () => {
    expect(allMigrations).toContain("function public.can_access_project");
    expect(allMigrations).toContain("project creators can read own projects");
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
    expect(allMigrations).toContain("public.current_streamer_id(organization_id)");
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
});
