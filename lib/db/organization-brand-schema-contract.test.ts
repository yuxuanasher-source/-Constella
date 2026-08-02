import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260801090000_organization_brand_studio.sql",
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const shareSnapshotMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260801100000_admission_share_brand_snapshot_rpc.sql",
);
const shareSnapshotSql = existsSync(shareSnapshotMigrationPath)
  ? readFileSync(shareSnapshotMigrationPath, "utf8").toLowerCase()
  : "";

function functionSqlFrom(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start < 0) {
    return "";
  }
  const end = source.indexOf("\n$$;", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 4);
}

function functionSql(name: string): string {
  return functionSqlFrom(sql, name);
}

function policySqlFrom(source: string, name: string): string {
  const start = source.indexOf(`create policy ${name}`);
  if (start < 0) {
    return "";
  }
  const end = source.indexOf(";", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 1);
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function expectDraftInsertPolicy(source: string): void {
  expect(
    compact(policySqlFrom(source, "organization_brand_drafts_owner_insert")),
  ).toBe(
    "create policy organization_brand_drafts_owner_insert on public.organization_brand_drafts for insert to authenticated with check ( public.current_user_role(organization_id) = 'owner' and updated_by = auth.uid() );",
  );
}

function expectUnknownFieldGuard(source: string): void {
  const publish = compact(
    functionSqlFrom(source, "publish_organization_brand"),
  );
  expect(publish).toContain(
    "from jsonb_object_keys(v_draft.content) as draft_field(key) where not ( draft_field.key = any ( array[ 'logotext', 'logostoragepath', 'brandname', 'brandtagline', 'primarycolor' ]::text[] ) )",
  );
}

function expectEmergencyShareFilter(source: string): void {
  const emergency = compact(
    functionSqlFrom(source, "emergency_remove_contact_card_from_shares"),
  );
  expect(emergency).toContain(
    "update public.project_recording_share_boards as board set contact_card_id = null, contact_card_snapshot = null where board.organization_id = p_organization_id and board.contact_card_id = p_contact_card_id and board.status = 'active' and board.expires_at > v_now and board.revoked_at is null;",
  );
}

function expectContactCardWritePermissions(source: string): void {
  const compacted = compact(source);
  expect(compacted).not.toContain(
    "create policy organization_contact_cards_owner_delete",
  );
  expect(compacted).not.toMatch(
    /create policy [^;]+ on public\.organization_contact_cards for (?:all|delete) to (?:public|anon|authenticated)/u,
  );
  expect(compacted).toContain(
    "revoke all on table public.organization_contact_cards from public, anon, authenticated;",
  );
  expect(compacted).toContain(
    "grant select, insert, update on table public.organization_contact_cards to authenticated;",
  );
  expect(compacted).not.toMatch(
    /grant (?:all(?: privileges)?|[^;]*\bdelete\b)[^;]* on table public\.organization_contact_cards to (?:public|anon|authenticated);/u,
  );
}

function expectContactCardShareLock(source: string): void {
  const guard = compact(
    functionSqlFrom(source, "guard_recording_share_contact_card"),
  );
  expect(guard).toContain(
    "where card.id = new.contact_card_id and card.organization_id = new.organization_id and card.status = 'active' for share;",
  );
}

describe("organization brand studio schema", () => {
  it("adds versioned brand storage with bounded integer versions and required indexes", () => {
    expect(sql).not.toBe("");
    expect(sql).toMatch(
      /alter table public\.organizations[\s\S]*add column if not exists branding_version integer not null default 0/,
    );
    expect(sql).toMatch(
      /organization_branding_version_nonnegative[\s\S]*check \(branding_version >= 0\)/,
    );
    expect(sql).toMatch(
      /create table public\.organization_brand_drafts \([\s\S]*organization_id uuid primary key references public\.organizations\(id\) on delete cascade[\s\S]*base_version integer not null[\s\S]*check \(base_version >= 0\)[\s\S]*content jsonb not null[\s\S]*updated_by uuid not null references public\.profiles\(id\)[\s\S]*created_at timestamptz not null default now\(\)[\s\S]*updated_at timestamptz not null default now\(\)/,
    );
    expect(sql).toMatch(
      /constraint organization_brand_drafts_updated_by_member_fkey[\s\S]*foreign key \(organization_id, updated_by\)[\s\S]*references public\.organization_members\(organization_id, user_id\)/,
    );
    expect(sql).toMatch(
      /create table public\.organization_brand_versions \([\s\S]*id uuid primary key default extensions\.gen_random_uuid\(\)[\s\S]*organization_id uuid not null references public\.organizations\(id\) on delete cascade[\s\S]*version integer not null[\s\S]*check \(version > 0\)[\s\S]*content jsonb not null[\s\S]*published_by uuid not null references public\.profiles\(id\)[\s\S]*published_at timestamptz not null default now\(\)[\s\S]*unique \(organization_id, version\)/,
    );
    expect(sql).toMatch(
      /create index organization_brand_versions_org_published_idx[\s\S]*on public\.organization_brand_versions \(organization_id, published_at desc\)/,
    );
  });

  it("creates governed contact cards with trimmed identity, contact, status, and lookup constraints", () => {
    expect(sql).toMatch(
      /create table public\.organization_contact_cards \([\s\S]*id uuid primary key default extensions\.gen_random_uuid\(\)[\s\S]*organization_id uuid not null references public\.organizations\(id\) on delete cascade/,
    );
    expect(sql).toMatch(
      /display_name text not null[\s\S]*char_length\(btrim\(display_name\)\) between 1 and 40/,
    );
    expect(sql).toMatch(
      /title text not null default ''[\s\S]*char_length\(title\) <= 40/,
    );
    expect(sql).toMatch(
      /phone text[\s\S]*email text[\s\S]*wechat text[\s\S]*status text not null default 'active'[\s\S]*status in \('active', 'disabled'\)/,
    );
    expect(sql).toMatch(
      /nullif\(btrim\(coalesce\(phone, ''\)\), ''\) is not null[\s\S]*nullif\(btrim\(coalesce\(email, ''\)\), ''\) is not null[\s\S]*nullif\(btrim\(coalesce\(wechat, ''\)\), ''\) is not null/,
    );
    expect(sql).toMatch(
      /created_by uuid not null references public\.profiles\(id\)[\s\S]*updated_by uuid not null references public\.profiles\(id\)[\s\S]*created_at timestamptz not null default now\(\)[\s\S]*updated_at timestamptz not null default now\(\)/,
    );
    expect(compact(sql)).toContain(
      "phone text check ( phone is null or char_length(btrim(phone)) <= 30 )",
    );
    expect(compact(sql)).toContain(
      "email text check ( email is null or ( char_length(btrim(email)) <= 120 and btrim(email) ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' ) )",
    );
    expect(compact(sql)).toContain(
      "wechat text check ( wechat is null or char_length(btrim(wechat)) <= 60 )",
    );
    expect(sql).toMatch(/unique \(organization_id, id\)/);
    for (const actor of ["created_by", "updated_by"]) {
      expect(sql).toMatch(
        new RegExp(
          `constraint organization_contact_cards_${actor}_member_fkey[\\s\\S]*foreign key \\(organization_id, ${actor}\\)[\\s\\S]*references public\\.organization_members\\(organization_id, user_id\\)`,
        ),
      );
    }
    expect(sql).toMatch(
      /create index organization_contact_cards_org_status_idx[\s\S]*on public\.organization_contact_cards \(organization_id, status, updated_at desc\)/,
    );
  });

  it("adds only the contact snapshot columns needed by emergency removal", () => {
    expect(sql).toMatch(
      /alter table public\.project_recording_share_boards[\s\S]*add column if not exists contact_card_id uuid[\s\S]*add column if not exists contact_card_snapshot jsonb/,
    );
    expect(sql).toMatch(
      /constraint project_recording_share_boards_contact_card_org_fkey[\s\S]*foreign key \(organization_id, contact_card_id\)[\s\S]*references public\.organization_contact_cards\(organization_id, id\)[\s\S]*on delete set null \(contact_card_id\)/,
    );
    expect(compact(sql)).toContain(
      "constraint project_recording_share_boards_contact_snapshot_consistency check ( contact_card_id is null or contact_card_snapshot is not null )",
    );
    expect(sql).toMatch(
      /create index project_recording_share_boards_contact_card_idx[\s\S]*on public\.project_recording_share_boards \(contact_card_id, organization_id\)[\s\S]*where contact_card_id is not null/,
    );
    expect(sql).not.toMatch(/\bbrand_snapshot\b/);
    expect(sql).not.toMatch(
      /project_recording_share_boards[\s\S]{0,160}add column if not exists brand_version/,
    );
  });

  it("maintains updated_at through the repository trigger helper", () => {
    for (const table of [
      "organization_brand_drafts",
      "organization_contact_cards",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_touch_updated_at[\\s\\S]*before update on public\\.${table}[\\s\\S]*execute function public\\.touch_updated_at\\(\\)`,
        ),
      );
    }
  });

  it("enables RLS and confines draft CRUD to exact-organization owners", () => {
    for (const table of [
      "organization_brand_drafts",
      "organization_brand_versions",
      "organization_contact_cards",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
    expect(
      compact(policySqlFrom(sql, "organization_brand_drafts_owner_select")),
    ).toBe(
      "create policy organization_brand_drafts_owner_select on public.organization_brand_drafts for select to authenticated using (public.current_user_role(organization_id) = 'owner');",
    );
    expectDraftInsertPolicy(sql);
    expect(
      compact(policySqlFrom(sql, "organization_brand_drafts_owner_update")),
    ).toBe(
      "create policy organization_brand_drafts_owner_update on public.organization_brand_drafts for update to authenticated using (public.current_user_role(organization_id) = 'owner') with check ( public.current_user_role(organization_id) = 'owner' and updated_by = auth.uid() );",
    );
    expect(
      compact(policySqlFrom(sql, "organization_brand_drafts_owner_delete")),
    ).toBe(
      "create policy organization_brand_drafts_owner_delete on public.organization_brand_drafts for delete to authenticated using (public.current_user_role(organization_id) = 'owner');",
    );
  });

  it("rejects a draft insert policy weakened to with check true", () => {
    const weakened = sql.replace(
      policySqlFrom(sql, "organization_brand_drafts_owner_insert"),
      "create policy organization_brand_drafts_owner_insert on public.organization_brand_drafts for insert to authenticated with check (true);",
    );
    expect(weakened).not.toBe(sql);
    expect(() => expectDraftInsertPolicy(weakened)).toThrow();
  });

  it("allows members to read published versions without allowing direct version mutation", () => {
    expect(sql).toMatch(
      /create policy organization_brand_versions_member_select[\s\S]*for select[\s\S]*public\.is_org_member\(organization_id\)/,
    );
    expect(sql).not.toMatch(
      /create policy organization_brand_versions_[^\n]*[\s\S]{0,180}for (?:all|insert|update|delete)/,
    );
    expect(sql).toMatch(
      /revoke insert, update, delete on table public\.organization_brand_versions from anon, authenticated, service_role/,
    );
  });

  it("lets owners read all cards and exact-organization members read only active cards without physical authenticated deletion", () => {
    expect(
      compact(policySqlFrom(sql, "organization_contact_cards_member_select")),
    ).toBe(
      "create policy organization_contact_cards_member_select on public.organization_contact_cards for select to authenticated using ( public.current_user_role(organization_id) = 'owner' or ( status = 'active' and public.is_org_member(organization_id) ) );",
    );
    expect(
      compact(policySqlFrom(sql, "organization_contact_cards_owner_insert")),
    ).toBe(
      "create policy organization_contact_cards_owner_insert on public.organization_contact_cards for insert to authenticated with check ( public.current_user_role(organization_id) = 'owner' and created_by = auth.uid() and updated_by = auth.uid() );",
    );
    expect(
      compact(policySqlFrom(sql, "organization_contact_cards_owner_update")),
    ).toBe(
      "create policy organization_contact_cards_owner_update on public.organization_contact_cards for update to authenticated using (public.current_user_role(organization_id) = 'owner') with check ( public.current_user_role(organization_id) = 'owner' and updated_by = auth.uid() );",
    );
    expectContactCardWritePermissions(sql);
  });

  it("rejects restoring an authenticated contact-card delete policy", () => {
    const weakened = `${sql}\ncreate policy organization_contact_cards_owner_delete on public.organization_contact_cards for delete to authenticated using (public.current_user_role(organization_id) = 'owner');`;
    expect(() => expectContactCardWritePermissions(weakened)).toThrow();
  });

  it("rejects restoring authenticated delete table privileges", () => {
    const weakened = `${sql}\ngrant delete on table public.organization_contact_cards to authenticated;`;
    expect(() => expectContactCardWritePermissions(weakened)).toThrow();
  });

  it("freezes contact-card identity while permitting same-organization actor attribution", () => {
    const guard = functionSql("guard_organization_contact_card_identity");
    expect(guard).toContain("set search_path = ''");
    expect(compact(guard)).toContain(
      "if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by then raise exception 'organization_contact_card_identity_is_immutable'",
    );
    expect(sql).toMatch(
      /create trigger organization_contact_cards_guard_identity[\s\S]*before update on public\.organization_contact_cards[\s\S]*execute function public\.guard_organization_contact_card_identity\(\)/,
    );
  });

  it("derives trusted contact snapshots on insert and freezes them on ordinary updates", () => {
    const guard = functionSql("guard_recording_share_contact_card");
    expect(guard).toContain("set search_path = ''");
    expect(guard).toMatch(
      /if tg_op = 'insert'[\s\S]*new\.contact_card_id is null[\s\S]*new\.contact_card_snapshot := null/,
    );
    expect(guard).toMatch(
      /from public\.organization_contact_cards as card[\s\S]*card\.id = new\.contact_card_id[\s\S]*card\.organization_id = new\.organization_id[\s\S]*card\.status = 'active'/,
    );
    expectContactCardShareLock(sql);
    expect(guard).toMatch(
      /new\.contact_card_snapshot := jsonb_strip_nulls\(jsonb_build_object\([\s\S]*'displayname', btrim\(v_card\.display_name\)[\s\S]*'title', nullif\(btrim\(v_card\.title\), ''\)[\s\S]*'phone', nullif\(btrim\(v_card\.phone\), ''\)[\s\S]*'email', nullif\(btrim\(v_card\.email\), ''\)[\s\S]*'wechat', nullif\(btrim\(v_card\.wechat\), ''\)/,
    );
    expect(guard).toContain("recording_share_contact_card_is_immutable");
    expect(compact(guard)).toContain(
      "if current_user = 'postgres' and new.contact_card_id is null and new.contact_card_snapshot is null then return new;",
    );
    expect(guard).toMatch(
      /pg_trigger_depth\(\) > 1[\s\S]*new\.contact_card_snapshot := old\.contact_card_snapshot/,
    );
    expect(sql).toMatch(
      /create trigger project_recording_share_boards_guard_contact_card[\s\S]*before insert or update on public\.project_recording_share_boards[\s\S]*execute function public\.guard_recording_share_contact_card\(\)/,
    );
  });

  it("rejects removing the contact-card share lock from snapshot derivation", () => {
    const weakened = sql.replace(
      "      and card.status = 'active'\n    for share;",
      "      and card.status = 'active';",
    );
    expect(weakened).not.toBe(sql);
    expect(() => expectContactCardShareLock(weakened)).toThrow();
  });

  it("publishes only for an authenticated exact-organization owner under row locks", () => {
    const publish = functionSql("publish_organization_brand");
    expect(publish).toMatch(/returns table \(/);
    expect(publish).toContain("security definer");
    expect(publish).toContain("set search_path = ''");
    expect(publish).toContain("v_actor_user_id uuid := auth.uid()");
    expect(publish).toMatch(
      /v_actor_user_id is null[\s\S]*public\.current_user_role\(p_organization_id\)[\s\S]*'owner'/,
    );
    expect(publish).toMatch(
      /from public\.organizations as organization[\s\S]*organization\.id = p_organization_id[\s\S]*for update/,
    );
    expect(publish).toMatch(
      /from public\.organization_brand_drafts as draft[\s\S]*draft\.organization_id = p_organization_id[\s\S]*for update/,
    );
  });

  it("enforces optimistic concurrency and safe integer publication", () => {
    const publish = functionSql("publish_organization_brand");
    const organizationLock = publish.indexOf(
      "from public.organizations as organization",
    );
    const expectedVersionCheck = publish.indexOf(
      "p_expected_version is distinct from v_organization.branding_version",
    );
    const draftLock = publish.indexOf(
      "from public.organization_brand_drafts as draft",
    );
    const draftBaseCheck = publish.indexOf(
      "v_draft.base_version is distinct from v_organization.branding_version",
    );
    expect(organizationLock).toBeGreaterThan(-1);
    expect(expectedVersionCheck).toBeGreaterThan(organizationLock);
    expect(draftLock).toBeGreaterThan(expectedVersionCheck);
    expect(draftBaseCheck).toBeGreaterThan(draftLock);
    expect(publish.slice(expectedVersionCheck, draftLock)).toContain(
      "brand_version_conflict",
    );
    expect(publish.slice(draftBaseCheck)).toContain("brand_version_conflict");
    expect(publish).toMatch(
      /v_organization\.branding_version >= 2147483647[\s\S]*brand_version_overflow/,
    );
    expect(publish).toMatch(
      /v_next_version := v_organization\.branding_version \+ 1/,
    );
  });

  it("rejects non-object, unknown, mistyped, or out-of-contract brand draft content", () => {
    const publish = functionSql("publish_organization_brand");
    expect(publish).toMatch(
      /jsonb_typeof\(v_draft\.content\) is distinct from 'object'/,
    );
    expect(publish).toMatch(
      /jsonb_object_keys\(v_draft\.content\)[\s\S]*'logotext'[\s\S]*'logostoragepath'[\s\S]*'brandname'[\s\S]*'brandtagline'[\s\S]*'primarycolor'/,
    );
    for (const field of [
      "logotext",
      "brandname",
      "brandtagline",
      "primarycolor",
    ]) {
      expect(publish).toMatch(
        new RegExp(
          `jsonb_typeof\\(v_draft\\.content -> '${field}'\\) is distinct from 'string'`,
        ),
      );
    }
    expect(publish).toMatch(
      /jsonb_typeof\(v_draft\.content -> 'logostoragepath'\)[\s\S]*'string'[\s\S]*'null'/,
    );
    expect(publish).toMatch(
      /char_length\(v_logo_text\) not between 1 and 8[\s\S]*char_length\(v_brand_name\) not between 1 and 40[\s\S]*char_length\(v_brand_tagline\) > 80/,
    );
    expect(publish).toMatch(/v_primary_color !~ '\^#\[0-9a-f\]\{6\}\$'/);
    expect(publish).toMatch(/v_logo_storage_path !~\* format\(/);
    expect(publish).toMatch(
      /\^%s\/brand-logos\/[\s\S]*\\\.webp\$[\s\S]*p_organization_id::text/,
    );
    expectUnknownFieldGuard(sql);
  });

  it("rejects an unknown-field guard weakened with where false and", () => {
    const weakened = sql.replace(
      "where not (\n      draft_field.key = any (",
      "where false and not (\n      draft_field.key = any (",
    );
    expect(weakened).not.toBe(sql);
    expect(() => expectUnknownFieldGuard(weakened)).toThrow();
  });

  it("builds the published projection server-side and atomically persists and audits it", () => {
    const publish = functionSql("publish_organization_brand");
    for (const key of [
      "schemaversion",
      "version",
      "logotext",
      "logostoragepath",
      "brandname",
      "brandtagline",
      "primarycolor",
      "actioncolor",
      "softcolor",
      "publishedat",
      "semantic",
    ]) {
      expect(publish).toContain(`'${key}'`);
    }
    expect(publish).toContain("'schemaversion', 1");
    expect(publish).toMatch(/'publishedat', v_published_at/);
    expect(publish).toContain("'success', '#00b42a'");
    expect(publish).not.toMatch(
      /v_draft\.content\s*->>?\s*'(?:version|publishedat|actioncolor|softcolor|semantic)'/,
    );

    const insertVersion = publish.indexOf(
      "insert into public.organization_brand_versions",
    );
    const updateOrganization = publish.indexOf("update public.organizations");
    const deleteDraft = publish.indexOf(
      "delete from public.organization_brand_drafts",
    );
    const insertAudit = publish.indexOf("insert into public.audit_logs");
    expect(insertVersion).toBeGreaterThan(-1);
    expect(updateOrganization).toBeGreaterThan(insertVersion);
    expect(deleteDraft).toBeGreaterThan(updateOrganization);
    expect(insertAudit).toBeGreaterThan(deleteDraft);
    expect(publish).toMatch(
      /insert into public\.audit_logs \([\s\S]*before_json[\s\S]*after_json[\s\S]*changed_fields[\s\S]*\) values \(/,
    );
    expect(publish).toContain("'publish'::public.audit_action");
    expect(publish).toMatch(
      /return query[\s\S]*v_next_version[\s\S]*v_published/,
    );
  });

  it("qualifies tenant columns inside the table-returning publication function", () => {
    const publish = functionSql("publish_organization_brand");
    expect(publish).toMatch(
      /delete from public\.organization_brand_drafts as draft_to_delete[\s\S]*where draft_to_delete\.organization_id = p_organization_id/,
    );
    expect(publish).not.toContain("v_step integer");
  });

  it("emergency-removes a card only from live exact-organization shares and writes high-risk evidence", () => {
    const emergency = functionSql("emergency_remove_contact_card_from_shares");
    expect(emergency).toContain("returns integer");
    expect(emergency).toContain("security definer");
    expect(emergency).toContain("set search_path = ''");
    expect(emergency).toContain("v_actor_user_id uuid := auth.uid()");
    expect(emergency).toMatch(
      /v_actor_user_id is null[\s\S]*public\.current_user_role\(p_organization_id\)[\s\S]*'owner'/,
    );
    expect(emergency).toMatch(
      /p_reason is null[\s\S]*nullif\(btrim\(p_reason\), ''\) is null/,
    );
    expect(emergency).toMatch(
      /from public\.organization_contact_cards as card[\s\S]*card\.id = p_contact_card_id[\s\S]*for update[\s\S]*v_card\.organization_id is distinct from p_organization_id/,
    );
    expectEmergencyShareFilter(sql);
    expect(emergency).toMatch(/get diagnostics v_affected_count = row_count/);
    expect(emergency).toMatch(
      /insert into public\.audit_logs[\s\S]*btrim\(p_reason\)[\s\S]*true[\s\S]*v_affected_count/,
    );
    expect(emergency).toContain("return v_affected_count");
  });

  it("rejects an emergency filter weakened from and status to or status", () => {
    const weakened = sql.replace(
      "and board.status = 'active'",
      "or board.status = 'active'",
    );
    expect(weakened).not.toBe(sql);
    expect(() => expectEmergencyShareFilter(weakened)).toThrow();
  });

  it("revokes default RPC execution before granting only authenticated callers", () => {
    expect(sql).toMatch(
      /revoke all on function public\.publish_organization_brand\(uuid, integer\) from public, anon, authenticated, service_role[\s\S]*grant execute on function public\.publish_organization_brand\(uuid, integer\) to authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.emergency_remove_contact_card_from_shares\(uuid, uuid, text\) from public, anon, authenticated, service_role[\s\S]*grant execute on function public\.emergency_remove_contact_card_from_shares\(uuid, uuid, text\) to authenticated/,
    );
    expect(sql).not.toMatch(/grant execute[\s\S]{0,180}to (?:public|anon)/);
    for (const triggerFunction of [
      "guard_organization_contact_card_identity",
      "guard_recording_share_contact_card",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${triggerFunction}() from public, anon, authenticated, service_role`,
      );
    }
  });
});

describe("admission share brand snapshot schema", () => {
  it("backfills normalized immutable brand snapshots before making them required", () => {
    expect(shareSnapshotSql).not.toBe("");
    expect(shareSnapshotSql).toMatch(
      /alter table public\.project_recording_share_boards[\s\S]*add column if not exists brand_snapshot jsonb[\s\S]*add column if not exists brand_version integer[\s\S]*add column if not exists contact_card_id uuid[\s\S]*add column if not exists contact_card_snapshot jsonb/,
    );
    expect(shareSnapshotSql).toMatch(
      /update public\.project_recording_share_boards as board[\s\S]*jsonb_build_object\([\s\S]*'schemaversion', 1[\s\S]*'version', organization\.branding_version[\s\S]*'logotext'[\s\S]*'logostoragepath'[\s\S]*'brandname'[\s\S]*'brandtagline'[\s\S]*'primarycolor'[\s\S]*'publishedat'[\s\S]*from public\.organizations as organization[\s\S]*organization\.id = board\.organization_id[\s\S]*board\.brand_snapshot is null/,
    );
    expect(shareSnapshotSql).not.toContain(
      "brand_snapshot = coalesce(board.brand_snapshot",
    );
    expect(shareSnapshotSql).not.toContain(
      "brand_version = coalesce(board.brand_version",
    );
    expect(shareSnapshotSql).toContain("'#165dff'");
    expect(shareSnapshotSql).toMatch(
      /alter table public\.project_recording_share_boards[\s\S]*alter column brand_snapshot set not null[\s\S]*alter column brand_version set not null/,
    );
  });

  it("rebuilds creation so only a contact-card id crosses the RPC boundary", () => {
    const createShare = functionSqlFrom(
      shareSnapshotSql,
      "create_admission_share_board",
    );
    expect(createShare).not.toBe("");
    expect(createShare).toMatch(/p_contact_card_id uuid/);
    expect(createShare).not.toContain("p_brand_snapshot");
    expect(createShare).not.toContain("p_contact_card_snapshot");
    expect(shareSnapshotSql).toMatch(
      /drop function if exists public\.create_admission_share_board\([\s\S]*jsonb[\s\S]*\);/,
    );
  });

  it("locks the organization and active same-organization card before the atomic insert", () => {
    const createShare = functionSqlFrom(
      shareSnapshotSql,
      "create_admission_share_board",
    );
    expect(createShare).toMatch(
      /from public\.organizations as organization[\s\S]*organization\.id = p_organization_id[\s\S]*for update/,
    );
    expect(createShare).toMatch(
      /from public\.organization_contact_cards as card[\s\S]*card\.id = p_contact_card_id[\s\S]*card\.organization_id = p_organization_id[\s\S]*card\.status = 'active'[\s\S]*for share/,
    );
    expect(createShare).toMatch(
      /if not found then[\s\S]*raise exception 'invalid_organization_contact_card'/,
    );
    expect(createShare).not.toContain("lock_admission_share_");
  });

  it("removes the externally callable raw lock helpers", () => {
    expect(
      functionSqlFrom(shareSnapshotSql, "lock_admission_share_contact_card"),
    ).toBe("");
    expect(
      functionSqlFrom(
        shareSnapshotSql,
        "lock_admission_share_organization_brand",
      ),
    ).toBe("");
    expect(compact(shareSnapshotSql)).toContain(
      "drop function if exists public.lock_admission_share_contact_card(uuid, uuid);",
    );
    expect(compact(shareSnapshotSql)).not.toContain(
      "grant execute on function public.lock_admission_share_contact_card",
    );
  });

  it("keeps emergency contact removal in the invoker update guard", () => {
    const guard = functionSqlFrom(
      shareSnapshotSql,
      "guard_recording_share_contact_card_update",
    );
    expect(guard).not.toContain("security definer");
    expect(guard).toContain("recording_share_contact_card_is_immutable");
    expect(compact(guard)).toContain(
      "if current_user = 'postgres' and new.contact_card_id is null and new.contact_card_snapshot is null then return new;",
    );
  });

  it("keeps the organization lock inside the non-callable insert trigger", () => {
    const organizationLock = functionSqlFrom(
      shareSnapshotSql,
      "derive_recording_share_brand_snapshot",
    );
    expect(organizationLock).not.toBe("");
    expect(organizationLock).toContain("security definer");
    expect(organizationLock).toContain("set search_path = ''");
    expect(organizationLock).toMatch(
      /auth\.uid\(\) is not null[\s\S]*not public\.is_mcn_staff\(new\.organization_id\)[\s\S]*insufficient_privilege/,
    );
    expect(organizationLock).toMatch(
      /from public\.organizations as organization[\s\S]*organization\.id = new\.organization_id[\s\S]*for update/,
    );
    expect(compact(shareSnapshotSql)).toContain(
      "revoke all on function public.derive_recording_share_brand_snapshot() from public, anon, authenticated, service_role;",
    );
  });

  it("records the trusted brand version and contact-card choice in the atomic created event", () => {
    const createdEvent = functionSqlFrom(
      shareSnapshotSql,
      "record_admission_share_board_created_event",
    );
    expect(createdEvent).toContain("'brandversion', new.brand_version");
    expect(createdEvent).toContain("'contactcardid', new.contact_card_id");
    expect(createdEvent).not.toContain("logo_storage_path");
    expect(createdEvent).not.toContain("brand_snapshot");
    expect(createdEvent).not.toContain("contact_card_snapshot");
  });

  it("derives trusted brand and contact snapshots on every direct insert and keeps both immutable", () => {
    const brandInsert = functionSqlFrom(
      shareSnapshotSql,
      "derive_recording_share_brand_snapshot",
    );
    const brandUpdate = functionSqlFrom(
      shareSnapshotSql,
      "guard_recording_share_brand_update",
    );
    const contactInsert = functionSqlFrom(
      shareSnapshotSql,
      "derive_recording_share_contact_card",
    );
    const contactUpdate = functionSqlFrom(
      shareSnapshotSql,
      "guard_recording_share_contact_card_update",
    );

    expect(brandInsert).toContain("security definer");
    expect(brandInsert).toContain("set search_path = ''");
    expect(brandInsert).toMatch(/for update[\s\S]*new\.brand_snapshot :=/);
    expect(brandInsert).toContain("new.brand_version :=");
    expect(brandUpdate).not.toContain("security definer");
    expect(brandUpdate).toContain("recording_share_brand_is_immutable");
    expect(contactInsert).toContain("security definer");
    expect(contactInsert).toMatch(/card\.status = 'active'[\s\S]*for share/);
    expect(contactUpdate).not.toContain("security definer");
    expect(contactUpdate).toContain(
      "recording_share_contact_card_is_immutable",
    );
    expect(compact(shareSnapshotSql)).toContain(
      "revoke all on function public.derive_recording_share_brand_snapshot() from public, anon, authenticated, service_role;",
    );
    expect(compact(shareSnapshotSql)).toContain(
      "revoke all on function public.derive_recording_share_contact_card() from public, anon, authenticated, service_role;",
    );
  });

  it("returns trusted creation hydration in the same transaction without callable raw-brand helpers", () => {
    const createShare = functionSqlFrom(
      shareSnapshotSql,
      "create_admission_share_board",
    );
    expect(createShare).toContain("security definer");
    expect(createShare).toContain("set search_path = ''");
    expect(createShare).toMatch(
      /returns table[\s\S]*board jsonb[\s\S]*snapshot jsonb/,
    );
    expect(createShare).toContain("build_admission_share_board_hydration");
    expect(createShare).not.toContain(
      "lock_admission_share_organization_brand",
    );
    expect(createShare).not.toContain("lock_admission_share_contact_card");
    expect(compact(shareSnapshotSql)).toContain(
      "drop function if exists public.lock_admission_share_organization_brand(uuid);",
    );
    expect(compact(shareSnapshotSql)).toContain(
      "drop function if exists public.lock_admission_share_contact_card(uuid, uuid);",
    );
  });

  it("hydrates one bounded keyset page in a single stable SQL statement", () => {
    const listHydrations = functionSqlFrom(
      shareSnapshotSql,
      "list_internal_admission_share_board_hydrations",
    );
    expect(listHydrations).toContain("language sql");
    expect(listHydrations).toContain("stable");
    expect(listHydrations).toContain("security definer");
    expect(listHydrations).toContain("p_before_created_at");
    expect(listHydrations).toContain("p_before_id");
    expect(listHydrations).toMatch(
      /board\.created_at < p_before_created_at[\s\S]*board\.created_at = p_before_created_at[\s\S]*board\.id < p_before_id/,
    );
    expect(listHydrations).toMatch(
      /order by board\.created_at desc, board\.id desc[\s\S]*limit least/,
    );
    expect(listHydrations).toContain(
      "build_admission_share_board_hydration(board.id)",
    );
    const buildHydration = functionSqlFrom(
      shareSnapshotSql,
      "build_admission_share_board_hydration",
    );
    expect(buildHydration).toContain(
      "guard_admission_share_board_hydration_size(board.id)",
    );
    expect(buildHydration).not.toMatch(
      /project_recording_share_items[\s\S]*limit 500/,
    );
    const hydrationGuard = functionSqlFrom(
      shareSnapshotSql,
      "guard_admission_share_board_hydration_size",
    );
    expect(hydrationGuard).toMatch(
      /count\(\*\) > 5000[\s\S]*admission_share_hydration_item_limit_exceeded/,
    );
    expect(compact(shareSnapshotSql)).toContain(
      "revoke all on function public.guard_admission_share_board_hydration_size(uuid) from public, anon, authenticated, service_role;",
    );
    const createShare = functionSqlFrom(
      shareSnapshotSql,
      "create_admission_share_board",
    );
    expect(createShare).toContain("jsonb_array_length(p_items) > 5000");
  });

  it("fully rebuilds partial, malformed, or version-mismatched backfill rows", () => {
    expect(shareSnapshotSql).toMatch(
      /jsonb_typeof\(board\.brand_snapshot\) is distinct from 'object'/,
    );
    expect(shareSnapshotSql).toMatch(
      /board\.brand_snapshot->'version' is distinct from to_jsonb\(board\.brand_version\)/,
    );
    expect(shareSnapshotSql).not.toContain(
      "brand_snapshot = coalesce(board.brand_snapshot",
    );
    expect(shareSnapshotSql).not.toContain(
      "brand_version = coalesce(board.brand_version",
    );
  });
});
