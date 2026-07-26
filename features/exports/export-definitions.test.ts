import { describe, expect, it } from "vitest";

import {
  exportDefinitions,
  getAllowedExportFields,
  isExportKind,
} from "./export-definitions";

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

  it("retires vendor_delivery as a governed export product kind", () => {
    expect(isExportKind("vendor_delivery")).toBe(false);
    expect(exportDefinitions).not.toHaveProperty("vendor_delivery");
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

  it("gates report settlement detail rate/fee columns by finance role", () => {
    expect(isExportKind("report_settlement_details")).toBe(true);

    const ownerKeys = getAllowedExportFields(
      "report_settlement_details",
      "owner",
    ).map((field) => field.key);
    expect(ownerKeys).toContain("hourlyRate");
    expect(ownerKeys).toContain("talentFee");
    expect(ownerKeys).toContain("guildOrIndividual");

    const operatorKeys = getAllowedExportFields(
      "report_settlement_details",
      "operator_business",
    ).map((field) => field.key);
    assertExportKeysExclude(operatorKeys, ["hourlyRate", "talentFee"]);
    expect(operatorKeys).toContain("streamerName");
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
