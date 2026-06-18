import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import {
  createProjectAuditWriter,
  updateProjectSettlementRule,
} from "@/features/projects/project-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const settlementMethods = new Set([
  "cpt",
  "cpa",
  "cps",
  "gift",
  "base_salary",
  "base_salary_cpt",
  "manual",
]);

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
      defaultSettlementMethod?: unknown;
      defaultHourlyRate?: unknown;
      defaultBaseSalary?: unknown;
      defaultSettlementRule?: unknown;
      reason?: unknown;
    };

    const defaultSettlementMethod = optionalSettlementMethod(
      body.defaultSettlementMethod,
    );
    const project = await updateProjectSettlementRule({
      repo: new SupabaseProjectRepository(supabase),
      audit: createProjectAuditWriter(supabase),
      actor: auth,
      projectId,
      input: {
        defaultSettlementMethod,
        defaultHourlyRate: optionalNumber(
          body.defaultHourlyRate,
          "defaultHourlyRate",
        ),
        defaultBaseSalary: optionalNumber(
          body.defaultBaseSalary,
          "defaultBaseSalary",
        ),
        defaultSettlementRule: optionalRulePayload(body.defaultSettlementRule),
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

function optionalSettlementMethod(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !settlementMethods.has(value)) {
    throw new Error("defaultSettlementMethod is invalid");
  }
  return value;
}

function optionalNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
  return parsed;
}

function optionalRulePayload(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("defaultSettlementRule must be an object");
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).length > 16 * 1024) {
    throw new Error("defaultSettlementRule is too large");
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
