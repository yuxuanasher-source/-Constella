import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateComplexCostPreview } from "./complex-cost-calculator";
import {
  calculateProjectFinancials,
  normalizeProjectFinancialSettings,
} from "./project-financials";
import {
  mapCostItemRow,
  mapEntitlementRow,
  mapRuleVersionRow,
} from "./complex-cost-repository";
import type {
  ComplexCostDashboardRecord,
  ComplexCostRuleVersionRecord,
  ProjectComplexCostEntitlementRecord,
  ProjectCostItemRecord,
} from "./complex-cost-types";

type CostItemQueryRow = Parameters<typeof mapCostItemRow>[0];
type EntitlementQueryRow = Parameters<typeof mapEntitlementRow>[0];
type RuleVersionQueryRow = Parameters<typeof mapRuleVersionRow>[0];

export type ProjectComplexCostSettingsDto = {
  entitlement: ProjectComplexCostEntitlementRecord | null;
  activeRule: ComplexCostRuleVersionRecord | null;
  draftRule: ComplexCostRuleVersionRecord | null;
};

export async function getProjectComplexCostSettings(
  client: SupabaseClient,
  input: { organizationId: string; projectId: string },
): Promise<ProjectComplexCostSettingsDto> {
  const [entitlement, activeRule, draftRule] = await Promise.all([
    getProjectEntitlement(client, input),
    getProjectRuleByStatus(client, { ...input, status: "active" }),
    getProjectRuleByStatus(client, { ...input, status: "draft" }),
  ]);

  return { entitlement, activeRule, draftRule };
}

export async function getProjectComplexCostDashboard(
  client: SupabaseClient,
  input: { organizationId: string; projectId: string },
): Promise<ComplexCostDashboardRecord> {
  const [items, settings] = await Promise.all([
    listProjectCostItems(client, input),
    getProjectFinancialSettings(client, input),
  ]);
  const supplierCostCents = sumItems(items, ["supplier_fee"]);
  const trafficCostCents = sumItems(items, ["traffic"]);
  const platformFeeCents = sumItems(items, ["platform_fee"]);
  const manualAdjustmentCents = sumItems(items, ["bonus", "penalty", "manual"]);
  const expectedReceivableCents = sumItems(items, ["cps", "gift"]);
  const preview = calculateComplexCostPreview({
    expectedReceivableCents,
    supplierCostCents,
    trafficCostCents,
    platformFeeBps: expectedReceivableCents
      ? Math.round((platformFeeCents / expectedReceivableCents) * 10000)
      : 0,
    manualAdjustmentCents,
  });

  // Layer the project financial settings (tax + procurement) onto the margin.
  const financials = calculateProjectFinancials({
    expectedReceivableCents,
    settings,
  });
  const grossMarginCents =
    (preview.grossMarginCents ?? 0) - financials.totalFinancialCostCents;
  const marginRateBps = expectedReceivableCents
    ? Math.round((grossMarginCents / expectedReceivableCents) * 10000)
    : 0;

  return {
    expectedReceivableCents,
    streamerPayableCents: preview.streamerPayableCents,
    supplierCostCents,
    trafficCostCents,
    platformFeeCents,
    manualAdjustmentCents,
    isInvoiced: financials.isInvoiced,
    outputVatRateBps: financials.outputVatRateBps,
    surtaxRateBps: financials.surtaxRateBps,
    outputVatCents: financials.outputVatCents,
    surtaxCents: financials.surtaxCents,
    procurementCostCents: financials.procurementCostCents,
    taxTotalCents: financials.outputVatCents + financials.surtaxCents,
    grossMarginCents,
    marginRateBps,
    items,
  };
}

async function getProjectFinancialSettings(
  client: SupabaseClient,
  input: { organizationId: string; projectId: string },
) {
  const { data, error } = await client
    .from("projects")
    .select(
      "is_invoiced, output_vat_rate_bps, surtax_rate_bps, procurement_cost_cents",
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.projectId)
    .maybeSingle<{
      is_invoiced: boolean | null;
      output_vat_rate_bps: number | null;
      surtax_rate_bps: number | null;
      procurement_cost_cents: number | null;
    }>();

  if (error) {
    throw error;
  }

  return normalizeProjectFinancialSettings({
    isInvoiced: data?.is_invoiced ?? false,
    outputVatRateBps: data?.output_vat_rate_bps ?? 0,
    surtaxRateBps: data?.surtax_rate_bps ?? 0,
    procurementCostCents: data?.procurement_cost_cents ?? 0,
  });
}

export async function listSettlementBatchProjectCostItems(
  client: SupabaseClient,
  input: { organizationId: string; settlementBatchId: string },
): Promise<ProjectCostItemRecord[]> {
  const { data, error } = await client
    .from("project_cost_items")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("settlement_batch_id", input.settlementBatchId)
    .order("created_at", { ascending: true })
    .returns<CostItemQueryRow[]>();

  if (error) {
    throw error;
  }
  return (data ?? []).map(mapCostItemRow);
}

async function getProjectEntitlement(
  client: SupabaseClient,
  input: { organizationId: string; projectId: string },
): Promise<ProjectComplexCostEntitlementRecord | null> {
  const { data, error } = await client
    .from("project_complex_cost_rule_entitlements")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .maybeSingle<EntitlementQueryRow>();

  if (error) {
    throw error;
  }
  return data ? mapEntitlementRow(data) : null;
}

async function getProjectRuleByStatus(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    status: "active" | "draft";
  },
): Promise<ComplexCostRuleVersionRecord | null> {
  const { data, error } = await client
    .from("project_cost_rule_versions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("status", input.status)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle<RuleVersionQueryRow>();

  if (error) {
    throw error;
  }
  return data ? mapRuleVersionRow(data) : null;
}

async function listProjectCostItems(
  client: SupabaseClient,
  input: { organizationId: string; projectId: string },
): Promise<ProjectCostItemRecord[]> {
  const { data, error } = await client
    .from("project_cost_items")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .neq("status", "voided")
    .order("created_at", { ascending: false })
    .returns<CostItemQueryRow[]>();

  if (error) {
    throw error;
  }
  return (data ?? []).map(mapCostItemRow);
}

function sumItems(
  items: ProjectCostItemRecord[],
  itemTypes: ProjectCostItemRecord["itemType"][],
): number {
  return items
    .filter((item) => itemTypes.includes(item.itemType))
    .reduce((sum, item) => sum + item.amountCents, 0);
}
