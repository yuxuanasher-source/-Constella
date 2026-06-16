import type { ProjectCostItemRecord } from "./complex-cost-types";

export type ProjectCostExportRow = {
  projectName: string;
  itemType: ProjectCostItemRecord["itemType"];
  amountCents: number;
  source: ProjectCostItemRecord["source"];
  reason: string;
};

export type SupplierReconcileExportRow = {
  projectName: string;
  supplierName: string;
  itemType: ProjectCostItemRecord["itemType"];
  amountCents: number;
  evidenceLevel: ProjectCostItemRecord["evidenceLevel"];
};

export function toProjectCostExportRows(input: {
  projectName: string;
  items: ProjectCostItemRecord[];
}): ProjectCostExportRow[] {
  return input.items.map((item) => ({
    projectName: input.projectName,
    itemType: item.itemType,
    amountCents: item.amountCents,
    source: item.source,
    reason: item.reason,
  }));
}

export function toSupplierReconcileExportRows(input: {
  projectName: string;
  supplierNamesById: Record<string, string>;
  items: ProjectCostItemRecord[];
}): SupplierReconcileExportRow[] {
  return input.items
    .filter((item) => Boolean(item.supplierOrganizationId))
    .map((item) => ({
      projectName: input.projectName,
      supplierName:
        input.supplierNamesById[item.supplierOrganizationId ?? ""] ??
        "Unknown supplier",
      itemType: item.itemType,
      amountCents: item.amountCents,
      evidenceLevel: item.evidenceLevel,
    }));
}
