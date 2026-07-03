import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260703130000_account_library_security_lifecycle.sql",
  ),
  "utf8",
);

describe("account library security & lifecycle schema contract", () => {
  it("adds the nurturing lifecycle status without using it in-transaction", () => {
    expect(migration).toContain(
      "alter type public.platform_account_status add value if not exists 'nurturing'",
    );
    // 同事务禁止使用新枚举值：不得出现 'nurturing' 的字面量赋值/比较
    const usages = migration
      .split("\n")
      .filter(
        (line) =>
          line.includes("'nurturing'") && !line.includes("add value"),
      );
    expect(usages).toEqual([]);
  });

  it("extends the account profile with followers, project and security info", () => {
    expect(migration).toContain("add column follower_count bigint not null");
    expect(migration).toContain(
      "add column project_id uuid references public.projects(id)",
    );
    expect(migration).toContain("add column security_phone text");
    expect(migration).toContain("add column security_email text");
    expect(migration).toContain("add column last_live_at timestamptz");
    expect(migration).toContain("add column last_synced_at timestamptz");
  });

  it("masks security credentials in the safe view", () => {
    expect(migration).toContain(
      "create or replace view public.platform_accounts_safe",
    );
    expect(migration).toContain("security_phone_masked");
    expect(migration).toContain("security_email_masked");
  });

  it("creates the security control tables", () => {
    expect(migration).toContain(
      "create table public.platform_account_devices",
    );
    expect(migration).toContain(
      "create table public.platform_account_login_logs",
    );
    expect(migration).toContain(
      "create table public.platform_account_ban_records",
    );
    expect(migration).toContain("unique (account_id, device_fingerprint)");
    expect(migration).toContain(
      "check (risk_level in ('normal', 'suspicious'))",
    );
  });

  it("creates lifecycle status logs and daily metrics tables", () => {
    expect(migration).toContain(
      "create table public.platform_account_status_logs",
    );
    expect(migration).toContain(
      "check (source in ('manual', 'auto_idle', 'metrics_sync'))",
    );
    expect(migration).toContain(
      "create table public.platform_account_metrics",
    );
    expect(migration).toContain("unique (account_id, metric_date)");
  });

  it("enables RLS with staff isolation on every new table", () => {
    for (const table of [
      "platform_account_devices",
      "platform_account_login_logs",
      "platform_account_ban_records",
      "platform_account_status_logs",
      "platform_account_metrics",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(`create policy ${table}_staff_access`);
      expect(migration).toContain(`grant all on table public.${table}`);
    }
    expect(migration).toContain(
      "create policy platform_account_metrics_streamer_read_own",
    );
  });
});
