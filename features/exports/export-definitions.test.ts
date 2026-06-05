import { describe, expect, it } from "vitest";

import { getAllowedExportFields } from "./export-definitions";

describe("export definitions", () => {
  it("keeps vendor delivery package free of cost and margin fields", () => {
    const fields = getAllowedExportFields(
      "vendor_delivery",
      "operator_business",
    );

    expect(fields.map((field) => field.key)).not.toContain("grossMarginCents");
    expect(fields.map((field) => field.key)).not.toContain("costCents");
    expect(fields.map((field) => field.key)).not.toContain(
      "vendorReceivableCents",
    );
  });

  it("blocks finance-sensitive fields from operator exports", () => {
    const fields = getAllowedExportFields(
      "settlement_batch",
      "operator_business",
    );

    expect(fields.map((field) => field.sensitivity)).not.toContain(
      "finance_sensitive",
    );
  });
});
