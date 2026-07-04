import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260703090000_streamer_lifecycle_management.sql",
  ),
  "utf8",
).toLowerCase();

describe("streamer lifecycle schema contract", () => {
  it("extends streamers with rating, lifecycle stage, contract and tier fields", () => {
    for (const column of [
      "rating text not null default 'unrated'",
      "lifecycle_stage text not null default 'recruited'",
      "lifecycle_stage_changed_at timestamptz",
      "contract_start_date date",
      "contract_end_date date",
      "revenue_share_bps integer",
      "operation_tier text not null default 'unassigned'",
      "operation_tags text[] not null default '{}'",
    ]) {
      expect(migration).toContain(column);
    }

    expect(migration).toContain("rating in ('unrated', 's', 'a', 'b', 'c')");
    expect(migration).toContain(
      "lifecycle_stage in ('recruited', 'trial', 'training', 'regular', 'paused', 'eliminated')",
    );
    expect(migration).toContain(
      "operation_tier in ('unassigned', 'core', 'potential', 'regular', 'observation')",
    );
    expect(migration).toContain(
      "revenue_share_bps >= 0 and revenue_share_bps <= 10000",
    );
    expect(migration).toContain("contract_end_date >= contract_start_date");
  });

  it("creates organization-scoped lifecycle tables with RLS enabled", () => {
    for (const table of [
      "streamer_lifecycle_events",
      "streamer_assessments",
      "streamer_attendance_records",
      "shift_change_requests",
      "streamer_performance_snapshots",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toMatch(
        new RegExp(
          `create table public\\.${table} \\([\\s\\S]*?organization_id uuid not null references public\\.organizations\\(id\\)`,
        ),
      );
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("keeps lifecycle events append-only for staff", () => {
    expect(migration).toContain("streamer_lifecycle_events_staff_read");
    expect(migration).toContain("streamer_lifecycle_events_staff_insert");
    expect(migration).not.toMatch(
      /create policy [\w_]+\s+on public\.streamer_lifecycle_events\s+for (all|update|delete)/,
    );
    expect(migration).toContain(
      "event_type in (\n      'stage_change',\n      'rating_change',\n      'tier_change',\n      'contract_change',\n      'assessment_concluded',\n      'shift_change_applied'\n    )",
    );
  });

  it("locks assessment enums and score bounds", () => {
    expect(migration).toContain(
      "assessment_type in ('trial', 'training', 'probation', 'periodic')",
    );
    expect(migration).toContain("status in ('pending', 'passed', 'failed')");
    expect(migration).toContain("score >= 0 and score <= 100");
  });

  it("keeps one attendance record per task with bounded statuses", () => {
    expect(migration).toContain("unique (organization_id, live_task_id)");
    expect(migration).toContain(
      "attendance_status in ('on_time', 'late', 'absent', 'leave')",
    );
    expect(migration).toContain("source in ('auto', 'manual')");
    expect(migration).toContain("late_minutes >= 0");
  });

  it("scopes shift change requests to requester streamers", () => {
    expect(migration).toContain("request_type in ('reschedule', 'substitute')");
    expect(migration).toContain(
      "status in ('pending', 'approved', 'rejected', 'cancelled')",
    );
    expect(migration).toContain("shift_change_requests_streamer_read_own");
    expect(migration).toContain("shift_change_requests_streamer_insert_own");
    expect(migration).toContain("shift_change_requests_streamer_cancel_own");
    expect(migration).toMatch(
      /shift_change_requests_streamer_insert_own[\s\S]*?streamer_id = public\.current_streamer_id\(organization_id\)/,
    );
  });

  it("keeps performance snapshots staff-only and unique per window", () => {
    expect(migration).toContain(
      "unique (organization_id, streamer_id, period_start, period_end)",
    );
    expect(migration).toContain(
      "broadcast_rate_bps >= 0 and broadcast_rate_bps <= 10000",
    );
    expect(migration).toContain("streamer_performance_snapshots_staff_access");
    expect(migration).not.toMatch(
      /create policy [\w_]+\s+on public\.streamer_performance_snapshots\s+for select\s+using \(streamer_id = public\.current_streamer_id/,
    );
  });

  it("adds touch_updated_at triggers to mutable lifecycle tables", () => {
    for (const table of [
      "streamer_assessments",
      "streamer_attendance_records",
      "shift_change_requests",
      "streamer_performance_snapshots",
    ]) {
      expect(migration).toContain(`create trigger ${table}_touch_updated_at`);
    }
  });
});
