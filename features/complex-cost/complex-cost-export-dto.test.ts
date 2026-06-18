import { describe, expect, it } from "vitest";

import {
  toProjectCostExportRows,
  toSupplierReconcileExportRows,
} from "./complex-cost-export-dto";

const item = {
  id: "cost-1",
  organizationId: "org-1",
  projectId: "project-1",
  supplierOrganizationId: "supplier-1",
  itemType: "supplier_fee" as const,
  amountCents: 12000,
  direction: "cost" as const,
  evidenceLevel: "yellow" as const,
  source: "manual" as const,
  sourcePayload: {},
  reason: "Supplier bill confirmed.",
  status: "confirmed" as const,
};

describe("complex cost export DTO", () => {
  it("maps project cost rows without gross margin fields", () => {
    expect(
      toProjectCostExportRows({
        projectName: "Launch Week",
        items: [item],
      }),
    ).toEqual([
      {
        projectName: "Launch Week",
        itemType: "supplier_fee",
        amountCents: 12000,
        source: "manual",
        reason: "Supplier bill confirmed.",
      },
    ]);
  });

  it("maps supplier reconciliation rows for supplier-scoped costs", () => {
    expect(
      toSupplierReconcileExportRows({
        projectName: "Launch Week",
        supplierNamesById: { "supplier-1": "Partner MCN" },
        items: [item],
      }),
    ).toEqual([
      {
        projectName: "Launch Week",
        supplierName: "Partner MCN",
        itemType: "supplier_fee",
        amountCents: 12000,
        evidenceLevel: "yellow",
      },
    ]);
  });
});
