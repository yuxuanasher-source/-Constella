import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  updateProjectFinancialSettings,
} from "@/features/projects/project-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await assertBillingWriteAllowed({
      client: supabase,
      organizationId: auth.organizationId,
      featureKey: "settlement",
    });

    const { projectId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      isInvoiced?: unknown;
      outputVatRateBps?: unknown;
      surtaxRateBps?: unknown;
      procurementCostCents?: unknown;
      reason?: unknown;
    };

    const project = await updateProjectFinancialSettings({
      repo: new SupabaseProjectRepository(supabase),
      audit: createProjectAuditWriter(supabase),
      actor: auth,
      projectId,
      input: {
        isInvoiced: optionalBoolean(body.isInvoiced),
        outputVatRateBps: optionalBps(
          body.outputVatRateBps,
          "outputVatRateBps",
        ),
        surtaxRateBps: optionalBps(body.surtaxRateBps, "surtaxRateBps"),
        procurementCostCents: optionalNonnegativeInt(
          body.procurementCostCents,
          "procurementCostCents",
        ),
      },
      reason: optionalText(body.reason) ?? "",
    });

    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

function optionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  return Boolean(value);
}

function optionalBps(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
    throw new Error(`${fieldName} must be between 0 and 10000`);
  }
  return Math.trunc(parsed);
}

function optionalNonnegativeInt(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
  return Math.trunc(parsed);
}

function optionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
