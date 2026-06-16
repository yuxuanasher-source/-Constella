import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { createGovernedExport } from "@/features/exports/export-service";
import type { ExportKind } from "@/features/exports/export-definitions";
import {
  arrayOfRecords,
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/complex-cost/complex-cost-route-utils";

const costExportKinds = new Set(["project_costs", "supplier_reconcile"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    await params;
    const body = await readJsonBody(request);
    const kind = requiredString(body, "kind");
    if (!costExportKinds.has(kind)) {
      throw new RouteError("Invalid complex cost export kind", 400);
    }

    const context = await getComplexCostRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const result = await createGovernedExport({
      client: context.supabase,
      actor: context.auth,
      kind: kind as ExportKind,
      rows: arrayOfRecords(body, "rows"),
    });

    return NextResponse.json({ export: result });
  } catch (error) {
    return jsonError(error);
  }
}
