import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import type {
  ComplexCostDashboardRecord,
  ProjectCostItemRecord,
} from "./complex-cost-types";

export type ComplexCostDashboardDto =
  | {
      expectedReceivableCents?: number;
      streamerPayableCents?: number;
      supplierCostCents?: number;
      trafficCostCents?: number;
      platformFeeCents?: number;
      manualAdjustmentCents?: number;
      isInvoiced?: boolean;
      outputVatRateBps?: number;
      surtaxRateBps?: number;
      outputVatCents?: number;
      surtaxCents?: number;
      procurementCostCents?: number;
      taxTotalCents?: number;
      grossMarginCents?: number;
      marginRateBps?: number;
      items: ProjectCostItemDto[];
    }
  | { items: [] };

export type ProjectCostItemDto = {
  id: string;
  itemType: ProjectCostItemRecord["itemType"];
  amountCents?: number;
  direction: ProjectCostItemRecord["direction"];
  evidenceLevel: ProjectCostItemRecord["evidenceLevel"];
  source: ProjectCostItemRecord["source"];
  reason?: string;
  status: ProjectCostItemRecord["status"];
};

export function toComplexCostDashboardDto(
  dashboard: ComplexCostDashboardRecord,
  role: AppRole,
): ComplexCostDashboardDto {
  if (!isMcnStaff(role)) {
    return { items: [] };
  }

  return {
    expectedReceivableCents: dashboard.expectedReceivableCents,
    streamerPayableCents: dashboard.streamerPayableCents,
    supplierCostCents: dashboard.supplierCostCents,
    trafficCostCents: dashboard.trafficCostCents,
    platformFeeCents: dashboard.platformFeeCents,
    manualAdjustmentCents: dashboard.manualAdjustmentCents,
    isInvoiced: dashboard.isInvoiced,
    outputVatRateBps: dashboard.outputVatRateBps,
    surtaxRateBps: dashboard.surtaxRateBps,
    outputVatCents: dashboard.outputVatCents,
    surtaxCents: dashboard.surtaxCents,
    procurementCostCents: dashboard.procurementCostCents,
    taxTotalCents: dashboard.taxTotalCents,
    grossMarginCents: dashboard.grossMarginCents,
    marginRateBps: dashboard.marginRateBps,
    items: dashboard.items.map(toProjectCostItemDto),
  };
}

function toProjectCostItemDto(item: ProjectCostItemRecord): ProjectCostItemDto {
  return {
    id: item.id,
    itemType: item.itemType,
    amountCents: item.amountCents,
    direction: item.direction,
    evidenceLevel: item.evidenceLevel,
    source: item.source,
    reason: item.reason,
    status: item.status,
  };
}
