import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260623140000_settlement_enhancement.sql",
  ),
  "utf8",
);

describe("settlement enhancement schema contract", () => {
  it("declares the line direction enum and the two new tables", () => {
    expect(migration).toContain(
      "create type public.settlement_line_direction",
    );
    expect(migration).toContain("create table public.settlement_line_items");
    expect(migration).toContain(
      "create table public.collaboration_settlements",
    );
  });

  it("supports project and streamer two-level dimensions", () => {
    expect(migration).toContain(
      "streamer_id uuid references public.streamers(id)",
    );
    expect(migration).toContain("settlement_line_items_amount_nonnegative");
  });

  it("keeps one collaboration settlement per batch", () => {
    expect(migration).toContain(
      "unique (settlement_batch_id, collaboration_id)",
    );
  });

  it("enables RLS and keeps partner read scoped to their own split", () => {
    expect(migration).toContain(
      "alter table public.settlement_line_items enable row level security",
    );
    expect(migration).toContain(
      "alter table public.collaboration_settlements enable row level security",
    );
    expect(migration).toContain("collaboration_settlements_partner_read");
    // cost / margin line items are never exposed to partners
    expect(migration).not.toContain("settlement_line_items_partner");
  });
});
