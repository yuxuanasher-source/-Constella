import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260620100000_p6_payment.sql"),
  "utf8",
).toLowerCase();
const foundationMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260601161000_initial_foundation.sql",
  ),
  "utf8",
).toLowerCase();
const webhookSource = readFileSync(
  join(process.cwd(), "features/billing/webhooks.ts"),
  "utf8",
);

describe("P6 payment schema contract", () => {
  it("creates the core payment tables", () => {
    for (const table of [
      "billing_plan_prices",
      "billing_orders",
      "billing_transactions",
      "billing_webhook_events",
      "invoice_requests",
      "invoices",
      "billing_reconciliations",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("enforces the three idempotency uniqueness gates", () => {
    expect(migration).toContain("unique (organization_id, idempotency_key)");
    expect(migration).toContain("unique (provider, provider_txn_id)");
    expect(migration).toContain("unique (provider, event_id)");
  });

  it("extends organization_subscriptions with lifecycle columns", () => {
    for (const column of [
      "grace_until",
      "pending_plan_id",
      "pending_billing_cycle",
      "auto_renew",
      "last_order_id",
    ]) {
      expect(migration).toContain(`add column ${column}`);
    }
  });

  it("keeps money integer-safe and org-scoped under RLS", () => {
    expect(migration).toContain("amount_cents integer not null");
    expect(migration).not.toContain(" double precision");
    for (const table of [
      "billing_orders",
      "billing_transactions",
      "invoice_requests",
      "invoices",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("restricts webhook events and reconciliations to service role", () => {
    expect(migration).toContain(
      "alter table public.billing_webhook_events enable row level security",
    );
    expect(migration).not.toContain("on public.billing_webhook_events for");
    expect(migration).not.toContain("on public.billing_reconciliations for");
  });

  it("keeps provider event ids out of the UUID audit object_id", () => {
    expect(foundationMigration).toMatch(
      /create table public\.audit_logs[\s\S]*?\bobject_id uuid/,
    );
    expect(webhookSource).not.toMatch(/objectId:\s*event\.eventId/);
    expect(webhookSource).toMatch(/webhookEventId:\s*event\.eventId/);
  });

  it("seeds plans and price versions idempotently", () => {
    expect(migration).toContain("insert into public.billing_plans");
    expect(migration).toContain("insert into public.billing_plan_prices");
    expect(migration).toContain("on conflict (code) do nothing");
  });
});
