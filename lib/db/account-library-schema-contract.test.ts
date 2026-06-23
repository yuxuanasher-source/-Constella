import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260623120000_account_library.sql",
  ),
  "utf8",
);

describe("account library schema contract", () => {
  it("declares the platform account enums and table", () => {
    expect(migration).toContain("create type public.platform_account_type");
    expect(migration).toContain("create type public.platform_account_status");
    expect(migration).toContain("create table public.platform_accounts");
  });

  it("requires account_uid and keeps the org/platform/uid uniqueness", () => {
    expect(migration).toContain("account_uid text not null");
    expect(migration).toContain(
      "unique (organization_id, platform, account_uid)",
    );
  });

  it("forces streamer-owned accounts to bind a streamer", () => {
    expect(migration).toContain(
      "platform_accounts_streamer_owned_requires_bind",
    );
  });

  it("enables RLS with staff isolation and streamer self-read", () => {
    expect(migration).toContain(
      "alter table public.platform_accounts enable row level security",
    );
    expect(migration).toContain("public.is_org_member(organization_id)");
    expect(migration).toContain("public.is_mcn_staff(organization_id)");
    expect(migration).toContain(
      "public.current_streamer_id(organization_id)",
    );
  });

  it("exposes a masked safe view for the real-name phone", () => {
    expect(migration).toContain(
      "create or replace view public.platform_accounts_safe",
    );
    expect(migration).toContain("real_name_phone_masked");
  });
});
