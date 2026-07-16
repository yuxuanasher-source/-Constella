import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260716160000_unified_finance_batches.sql",
  ),
  "utf8",
).toLowerCase();

describe("unified finance batch schema", () => {
  it("creates finance batch tables", () => {
    expect(migration).toContain(
      "create table if not exists public.finance_batches",
    );
    expect(migration).toContain(
      "create table if not exists public.finance_batch_items",
    );
    expect(migration).toContain(
      "create table if not exists public.finance_batch_adjustments",
    );
  });

  it("defines typed batches and status checks", () => {
    expect(migration).toContain("finance_batches_batch_type_check");
    for (const batchType of [
      "receivable",
      "streamer_payable",
      "project_cost",
      "collaboration_share",
    ]) {
      expect(migration).toContain(batchType);
    }

    expect(migration).toContain("finance_batches_status_check");
    for (const status of [
      "draft",
      "pending_review",
      "confirmed",
      "locked",
      "exported",
      "completed",
      "rejected",
      "reopened",
      "voided",
    ]) {
      expect(migration).toContain(status);
    }
  });

  it("prevents duplicate active source consumption", () => {
    expect(migration).toContain("finance_batch_items_active_source_uidx");
    expect(migration).toMatch(
      /unique index[\s\S]*finance_batch_items[\s\S]*organization_id[\s\S]*batch_type[\s\S]*source_type[\s\S]*source_id/,
    );
    expect(migration).toMatch(
      /finance_batch_items_active_source_uidx[\s\S]*where status = 'active'/,
    );
  });

  it("keeps project attribution on every item", () => {
    expect(migration).toMatch(
      /project_id uuid not null references public\.projects\(id\)/,
    );
    expect(migration).toContain("finance_batch_project_summary");
    for (const summaryColumn of [
      "receivable_amount",
      "streamer_payable_amount",
      "project_cost_amount",
      "collaboration_share_amount",
      "gross_margin_impact",
    ]) {
      expect(migration).toContain(summaryColumn);
    }
    expect(migration).toMatch(
      /create or replace view public\.finance_batch_project_summary\s+with \(security_invoker = true\)\s+as/,
    );
  });

  it("adds staff-scoped rls policies", () => {
    expect(migration).toContain("enable row level security");
    for (const policy of [
      ["finance_batches_staff_read", "finance_batches"],
      ["finance_batch_items_staff_read", "finance_batch_items"],
      ["finance_batch_adjustments_staff_read", "finance_batch_adjustments"],
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `create policy ${policy[0]}[\\s\\S]*on public\\.${policy[1]}[\\s\\S]*using \\(public\\.is_mcn_staff\\(organization_id\\)\\)`,
        ),
      );
    }
  });

  it("keeps finance writes behind staff-scoped security-definer rpcs", () => {
    for (const rpc of [
      "create_finance_batch",
      "add_finance_batch_adjustment",
      "transition_finance_batch",
    ]) {
      expect(migration).toContain(`function public.${rpc}`);

      const functionStart = migration.indexOf(`function public.${rpc}`);
      const revokeStart = migration.indexOf(`revoke all on function public.${rpc}`);
      expect(functionStart).toBeGreaterThanOrEqual(0);
      expect(revokeStart).toBeGreaterThan(functionStart);

      const definition = migration.slice(functionStart, revokeStart);
      expect(definition).toContain("security definer");
      expect(definition).toContain("set search_path = pg_catalog, public");
      expect(definition).toContain("v_actor_id uuid := auth.uid()");
      expect(definition).toContain("if v_actor_id is null then");
      expect(definition).toContain("public.is_org_member(p_organization_id)");
      expect(definition).toContain("public.is_mcn_staff(p_organization_id)");
    }

    expect(migration).toContain("if p_created_by <> v_actor_id then");
    expect(migration).toContain("if p_actor_user_id <> v_actor_id then");
    expect(migration).toContain("finance_batch_adjustment_item_scope_mismatch");

    for (const signature of [
      "public.create_finance_batch",
      "public.add_finance_batch_adjustment",
      "public.transition_finance_batch",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function ${signature}\\([\\s\\S]+?from public, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function ${signature}\\([\\s\\S]+?to authenticated;`,
        ),
      );
    }
  });

  it("voids child items when a batch is voided", () => {
    expect(migration).toContain(
      "function public.finance_batches_void_items_fn()",
    );
    expect(migration).toContain("old.status is distinct from 'voided'");
    expect(migration).toMatch(
      /update public\.finance_batch_items[\s\S]*set[\s\S]*status = 'voided'[\s\S]*where finance_batch_id = new\.id[\s\S]*and organization_id = new\.organization_id/,
    );
    expect(migration).toContain("finance_batches_void_items");
    expect(migration).toContain("after update of status on public.finance_batches");
  });

  it("ties child rows to parent batch identity", () => {
    expect(migration).toContain("finance_batches_id_org_type_key");
    expect(migration).toContain("finance_batches_id_org_key");
    expect(migration).toContain("finance_batch_items_id_batch_org_key");
    expect(migration).toMatch(
      /foreign key \(\s*finance_batch_id,\s*organization_id,\s*batch_type\s*\)[\s\S]*references public\.finance_batches \(\s*id,\s*organization_id,\s*batch_type\s*\)/,
    );
    expect(migration).toMatch(
      /foreign key \(\s*finance_batch_id,\s*organization_id\s*\)[\s\S]*references public\.finance_batches \(\s*id,\s*organization_id\s*\)/,
    );
    expect(migration).toMatch(
      /foreign key \(\s*finance_batch_item_id,\s*finance_batch_id,\s*organization_id\s*\)[\s\S]*references public\.finance_batch_items \(\s*id,\s*finance_batch_id,\s*organization_id\s*\)/,
    );
  });

  it("validates jsonb shapes", () => {
    for (const check of [
      "jsonb_typeof(metadata) = 'object'",
      "jsonb_typeof(source_snapshot) = 'object'",
      "jsonb_typeof(evidence_snapshot) = 'object'",
      "jsonb_typeof(exception_flags) = 'array'",
    ]) {
      expect(migration).toContain(check);
    }
  });

  it("touches updated_at for mutable finance tables", () => {
    for (const trigger of [
      "finance_batches_touch_updated_at",
      "finance_batch_items_touch_updated_at",
      "finance_batch_adjustments_touch_updated_at",
    ]) {
      expect(migration).toContain(`create trigger ${trigger}`);
      expect(migration).toContain("execute function public.touch_updated_at()");
    }
  });
});
