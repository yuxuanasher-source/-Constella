import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260726120000_admission_share_public_security.sql",
  ),
  "utf8",
).toLowerCase();

describe("admission share public security migration", () => {
  it("adds backward-compatible salt and access-code lockout state", () => {
    expect(migration).toContain("access_code_salt text");
    expect(migration).toContain(
      "access_code_failure_count integer not null default 0",
    );
    expect(migration).toContain("access_code_locked_until timestamptz");
    expect(migration).toContain("access_code_failure_count >= 0");
  });

  it("creates an RLS-protected rate-limit table and one atomic bucket RPC", () => {
    expect(migration).toContain(
      "create table public.admission_share_public_rate_limit_buckets",
    );
    expect(migration).toContain(
      "alter table public.admission_share_public_rate_limit_buckets enable row level security",
    );
    expect(migration).toMatch(
      /create or replace function public\.consume_admission_share_rate_limit\([\s\S]+security definer[\s\S]+set search_path = pg_catalog, public[\s\S]+on conflict \(scope, dimension_hash\) do update/u,
    );
    expect(migration).toContain("p_limit <= 0");
    expect(migration).toContain("p_window_seconds <= 0");
  });

  it("pins and restricts all public-security RPC privileges to service_role", () => {
    for (const rpc of [
      "consume_admission_share_rate_limit",
      "record_admission_share_access_code_failure",
      "reset_admission_share_access_code_failures",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${rpc}\\([\\s\\S]+?from public, anon, authenticated;`,
          "u",
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${rpc}\\([\\s\\S]+?to service_role;`,
          "u",
        ),
      );
    }
    expect(migration).not.toMatch(
      /create policy[\s\S]+admission_share_public_rate_limit_buckets/u,
    );
  });

  it("atomically applies the five-failure, 15-minute lock and reset rules", () => {
    expect(migration).toMatch(
      /create or replace function public\.record_admission_share_access_code_failure\([\s\S]+security definer[\s\S]+set search_path = pg_catalog, public[\s\S]+update public\.project_recording_share_boards/u,
    );
    expect(migration).toContain(
      "least(board.access_code_failure_count + 1, 5)",
    );
    expect(migration).toContain("p_failed_at + interval '15 minutes'");
    expect(migration).toMatch(
      /create or replace function public\.reset_admission_share_access_code_failures\([\s\S]+access_code_failure_count = 0,[\s\S]+access_code_locked_until = null/u,
    );
  });
});
