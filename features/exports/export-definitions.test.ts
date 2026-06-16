import { describe, expect, it } from "vitest";

import { getAllowedExportFields, isExportKind } from "./export-definitions";

describe("export definitions", () => {
  it("keeps admission recording exports scoped to public review fields", () => {
    const fields = getAllowedExportFields(
      "admission_recordings",
      "operator_business",
    );
    const fieldKeys = fields.map((field) => field.key);

    expect(fieldKeys).toEqual([
      "projectCode",
      "projectName",
      "vendorProduct",
      "streamerName",
      "streamerAccount",
      "recordingUrl",
      "recordingVersion",
      "recordingSubmittedAt",
      "mcnReviewStatus",
      "vendorDecision",
      "vendorRemark",
    ]);
    assertExportKeysExclude(fieldKeys, [
      "vendorReceivableCents",
      "grossMarginCents",
      "supplierCostCents",
      "internalRiskNote",
      "settlementPrice",
    ]);
  });

  it("fails the guard when any single finance-sensitive field is present", () => {
    expect(() =>
      assertExportKeysExclude(
        ["projectName", "grossMarginCents"],
        ["vendorReceivableCents", "grossMarginCents"],
      ),
    ).toThrow(/grossMarginCents/);
  });

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

  it("supports project cost and supplier reconciliation exports", () => {
    expect(isExportKind("project_costs")).toBe(true);
    expect(isExportKind("supplier_reconcile")).toBe(true);
    expect(
      getAllowedExportFields("project_costs", "operator_business"),
    ).not.toContainEqual(
      expect.objectContaining({ sensitivity: "finance_sensitive" }),
    );
  });
});

function assertExportKeysExclude(
  keys: string[],
  forbiddenKeys: string[],
): void {
  for (const forbiddenKey of forbiddenKeys) {
    expect(keys, `forbidden export field ${forbiddenKey}`).not.toContain(
      forbiddenKey,
    );
  }
}
