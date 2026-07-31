import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260731100000_knowledge_share_links.sql",
);

describe("knowledge share schema contract", () => {
  it("declares the migration safe for the atomic expand phase", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    expect(
      readFileSync(migrationPath, "utf8").startsWith("-- deploy: expand\n"),
    ).toBe(true);
  });

  it("defines a dedicated metadata table without storing plaintext tokens", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, "utf8").toLowerCase();
    expect(migration).toContain("create table public.knowledge_share_links");
    expect(migration).toContain("token_hash text not null unique");
    expect(migration).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).not.toMatch(/(^|\s)token\s+text/);
    expect(migration).not.toContain("plaintext_token");
    expect(migration).toContain("knowledge-base-share/");
  });

  it("keeps anonymous users off the table and scopes authenticated management", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, "utf8").toLowerCase();
    expect(migration).toContain(
      "alter table public.knowledge_share_links enable row level security",
    );
    expect(migration).toMatch(
      /revoke all on table public\.knowledge_share_links\s+from public, anon, authenticated/,
    );
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("organization_members");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("'owner'");
    expect(migration).toContain("'ops_manager'");
    expect(migration).toContain("'operator_business'");
    expect(migration).toContain("organization_id");
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[^;]*knowledge_share_links[^;]*authenticated/,
    );
    expect(migration).toContain(
      "grant all on table public.knowledge_share_links to service_role",
    );
  });

  it("models pending, active, failed and revoked lifecycle states", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, "utf8").toLowerCase();
    expect(migration).toContain("status text not null default 'pending'");
    expect(migration).toContain("'pending', 'active', 'failed'");
    expect(migration).toContain("request_key");
    expect(migration).toContain("expires_at");
    expect(migration).toContain("revoked_at");
    expect(migration).toContain("revoked_by");
    expect(migration).toMatch(
      /alter type public\.audit_action\s+add value if not exists 'create_knowledge_share'/,
    );
    expect(migration).toMatch(
      /alter type public\.audit_action\s+add value if not exists 'revoke_knowledge_share'/,
    );
  });
});
