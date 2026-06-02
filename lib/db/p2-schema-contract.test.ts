import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const p2Migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260602103000_p2_settlement_backend.sql",
  ),
  "utf8",
);
const streamerSafeViewMigration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260602154500_fix_streamer_payable_safe_view.sql",
  ),
  "utf8",
);

describe("P2 settlement schema contract", () => {
  it("indexes the approved unsettled report pool", () => {
    expect(p2Migration).toContain("live_reports_settlement_pool_idx");
    expect(p2Migration).toContain("status = 'approved'");
    expect(p2Migration).toContain("settled_batch_item_id is null");
  });

  it("keeps finance read-only at the RLS write boundary", () => {
    expect(p2Migration).toContain(
      'drop policy if exists "staff can manage settlement batches"',
    );
    expect(p2Migration).toContain(
      'create policy "owner ops can manage settlement batches"',
    );
    expect(p2Migration).toContain(
      'create policy "owner ops can manage settlement items"',
    );
    expect(p2Migration).not.toContain("'finance'");
  });

  it("keeps the streamer payable view non-empty without exposing batch table reads", () => {
    expect(streamerSafeViewMigration).toContain(
      "public.streamer_payable_items_safe",
    );
    expect(streamerSafeViewMigration).toContain(
      "with (security_invoker = false)",
    );
    expect(streamerSafeViewMigration).toContain(
      "sbi.streamer_id = public.current_streamer_id(sbi.organization_id)",
    );
    expect(streamerSafeViewMigration).toContain(
      "where sb.batch_type = 'payable'",
    );
  });
});
