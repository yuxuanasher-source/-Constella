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
      "greatest(max(item.updated_at), max(batch.updated_at)) as updated_at",
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

    expect(migration).toContain("if p_created_by is distinct from v_actor_id then");
    expect(migration).toContain(
      "if p_actor_user_id is distinct from v_actor_id then",
    );
    expect(migration).not.toContain("if p_created_by <> v_actor_id then");
    expect(migration).not.toContain("if p_actor_user_id <> v_actor_id then");
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

  it("computes parent batch totals from item payloads", () => {
    const functionStart = migration.indexOf(
      "function public.create_finance_batch",
    );
    const functionEnd = migration.indexOf(
      "create or replace function public.add_finance_batch_adjustment",
    );
    const definition = migration.slice(functionStart, functionEnd);

    for (const computedValue of [
      "v_system_amount numeric(14, 2) := 0",
      "v_adjustment_amount numeric(14, 2) := 0",
      "v_final_amount numeric(14, 2) := 0",
      "v_item_count integer := 0",
      "v_exception_count integer := 0",
      "v_has_exceptions boolean := false",
      "v_system_amount := v_system_amount +",
      "v_adjustment_amount := v_adjustment_amount +",
      "v_final_amount := v_final_amount +",
      "v_item_count := v_item_count + 1",
      "v_exception_count := v_exception_count + 1",
      "v_has_exceptions := v_exception_count > 0",
    ]) {
      expect(definition).toContain(computedValue);
    }

    expect(definition).toContain(
      "jsonb_array_length(v_item_exception_flags) > 0",
    );
    expect(definition).toMatch(
      /insert into public\.finance_batches[\s\S]*system_amount,[\s\S]*adjustment_amount,[\s\S]*final_amount,[\s\S]*item_count,[\s\S]*exception_count,[\s\S]*has_exceptions[\s\S]*values \([\s\S]*v_system_amount,[\s\S]*v_adjustment_amount,[\s\S]*v_final_amount,[\s\S]*v_item_count,[\s\S]*v_exception_count,[\s\S]*v_has_exceptions/,
    );
    expect(definition).not.toMatch(
      /values \([\s\S]*p_system_amount,[\s\S]*p_adjustment_amount,[\s\S]*p_final_amount/,
    );
  });

  it("enforces the finance batch sql status transition graph", () => {
    const functionStart = migration.indexOf(
      "function public.transition_finance_batch",
    );
    const revokeStart = migration.indexOf(
      "revoke all on function public.transition_finance_batch",
    );
    const definition = migration.slice(functionStart, revokeStart);

    expect(definition).toMatch(
      /select \*[\s\S]*into v_batch[\s\S]*from public\.finance_batches[\s\S]*for update;/,
    );
    expect(definition).toContain(
      "finance_batch_transition_invalid",
    );
    expect(definition).toContain(
      "finance_batch_transition_reason_required",
    );
    expect(definition).toContain(
      "p_next_status in ('reopened', 'voided')",
    );
    expect(definition).toContain(
      "v_batch.status in ('draft', 'reopened') and p_next_status = 'pending_review'",
    );
    expect(definition).toContain(
      "v_batch.status = 'pending_review' and p_next_status in ('confirmed', 'rejected')",
    );
    expect(definition).toContain(
      "v_batch.status = 'confirmed' and p_next_status = 'locked'",
    );
    expect(definition).toContain(
      "v_batch.status = 'locked' and p_next_status in ('exported', 'reopened')",
    );
    expect(definition).toContain(
      "v_batch.status = 'exported' and p_next_status in ('completed', 'reopened')",
    );
    expect(definition).toContain(
      "v_batch.status = 'completed' and p_next_status = 'reopened'",
    );
    expect(definition).toContain(
      "v_batch.status in ('draft', 'pending_review', 'rejected', 'reopened') and p_next_status = 'voided'",
    );
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

  it("rejects empty finance batch item payloads in the create rpc", () => {
    expect(migration).toContain(
      "jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0",
    );
    expect(migration).toContain("finance_batch_items_required");
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
