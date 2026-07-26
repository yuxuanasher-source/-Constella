import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260724190000_xingyao_hermes_root_invocation_atomicity.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

function functionSql(functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = migration.indexOf(marker);
  if (start < 0) return "";
  const end = migration.indexOf("\n$$;", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 4);
}

describe("Xingyao Hermes root invocation atomicity schema contract", () => {
  it("ships a service-only atomic root capability RPC", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const issueRoot = functionSql("issue_ai_hermes_root_run_capability");

    expect(issueRoot).toContain("language plpgsql");
    expect(issueRoot).toContain("security definer");
    expect(issueRoot).toContain("set search_path = pg_catalog, public");
    expect(migration).toContain(
      "revoke all on function public.issue_ai_hermes_root_run_capability(",
    );
    expect(migration).toContain(
      "grant execute on function public.issue_ai_hermes_root_run_capability(",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.issue_ai_hermes_root_run_capability\([^;]*to (anon|authenticated);/,
    );
  });

  it("creates, verifies, and issues the root ledger in one database transaction", () => {
    const issueRoot = functionSql("issue_ai_hermes_root_run_capability");

    expect(issueRoot).toMatch(
      /insert into public\.ai_invocations[\s\S]*?on conflict \(id\) do nothing/,
    );
    expect(issueRoot).toContain("from public.ai_invocations invocation");
    for (const binding of [
      "invocation.organization_id is distinct from p_organization_id",
      "invocation.actor_user_id is distinct from p_owner_user_id",
      "invocation.actor_role is distinct from p_actor_role",
      "invocation.scene is distinct from 'dashboard_ai_chat'",
      "invocation.object_type is distinct from 'ai_chat_turn'",
      "invocation.object_id is distinct from p_turn_id::text",
      "invocation.provider_name is distinct from 'hermes'",
      "invocation.primary_provider is distinct from 'hermes'",
      "invocation.metadata ->> 'hermesmode'",
      "invocation.metadata ->> 'hermesrootinvocationid'",
    ]) {
      expect(issueRoot).toContain(binding);
    }
    expect(issueRoot).toContain("root_invocation_identity_conflict");
    expect(issueRoot).toContain(
      "'hermesactorfingerprint', lower(p_actor_fingerprint)",
    );
    expect(issueRoot).toContain(
      "public.issue_ai_hermes_run_capability(",
    );
    expect(issueRoot.indexOf("insert into public.ai_invocations")).toBeLessThan(
      issueRoot.indexOf("public.issue_ai_hermes_run_capability("),
    );
  });

  it("uses the established conversation, turn, invocation lock order", () => {
    const issueRoot = functionSql("issue_ai_hermes_root_run_capability");
    const conversationLock = issueRoot.indexOf(
      "from public.ai_conversations conversation",
    );
    const turnLock = issueRoot.indexOf("from public.ai_chat_turns turn");
    const invocationLock = issueRoot.indexOf(
      "from public.ai_invocations invocation",
    );

    expect(conversationLock).toBeGreaterThan(-1);
    expect(turnLock).toBeGreaterThan(conversationLock);
    expect(invocationLock).toBeGreaterThan(turnLock);
  });

  it("binds the requested role to an active organization membership", () => {
    const issueRoot = functionSql("issue_ai_hermes_root_run_capability");

    expect(issueRoot).toContain("from public.organization_members member");
    expect(issueRoot).toContain("member.organization_id = p_organization_id");
    expect(issueRoot).toContain("member.user_id = p_owner_user_id");
    expect(issueRoot).toContain("member.status = 'active'");
    expect(issueRoot).toContain("member.role = p_actor_role");
    expect(issueRoot).toContain("root_invocation_actor_invalid");
  });

  it("closes the linked invocation when a chat turn reaches a terminal state", () => {
    const closeInvocation = functionSql(
      "complete_ai_invocation_for_terminal_chat_turn",
    );

    expect(closeInvocation).toContain("returns trigger");
    expect(closeInvocation).toContain("update public.ai_invocations invocation");
    expect(closeInvocation).toContain(
      "invocation.organization_id = new.organization_id",
    );
    expect(closeInvocation).toContain(
      "invocation.actor_user_id = new.owner_user_id",
    );
    expect(closeInvocation).toContain(
      "invocation.status in ('started', 'queued')",
    );
    expect(closeInvocation).toContain("when 'completed' then");
    expect(closeInvocation).toContain("'succeeded'");
    expect(closeInvocation).toContain("'degraded'");
    expect(closeInvocation).toContain("'failed'");
    expect(migration).toMatch(
      /create trigger ai_chat_turns_complete_linked_invocation\s+after update of status, outcome, ai_invocation_id on public\.ai_chat_turns/,
    );
  });
});
