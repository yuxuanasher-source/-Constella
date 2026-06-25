import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  PROJECT_STREAMER_SETTLEMENT_METHODS,
  updateProjectStreamerSettlementRule,
  type ProjectStreamerSettlementMethod,
} from "@/features/settlements/project-streamer-settlement-service";
import { SupabaseSettlementRepository } from "@/features/settlements/settlement-repository";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; streamerId: string }> },
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

    const { projectId, streamerId } = await params;
    const body = (await request
      .json()
      .catch(() => ({}))) as ProjectStreamerSettlementPatchBody;

    const settlementMethod = normalizeEnum(
      body.settlementMethod,
      PROJECT_STREAMER_SETTLEMENT_METHODS,
      "settlementMethod",
    );
    if (settlementMethod instanceof Response) {
      return settlementMethod;
    }

    const record = await updateProjectStreamerSettlementRule({
      repo: new SupabaseSettlementRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      projectId,
      streamerId,
      input: {
        settlementMethod: settlementMethod as
          | ProjectStreamerSettlementMethod
          | undefined,
        hourlyRate: optionalNumber(body.hourlyRate, "hourlyRate"),
        baseSalary: optionalNumber(body.baseSalary, "baseSalary"),
        cpsRateBps: optionalInteger(body.cpsRateBps, "cpsRateBps"),
      },
      reason: normalizeOptionalText(body.reason) ?? "",
    });

    return NextResponse.json({ projectStreamer: record });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type ProjectStreamerSettlementPatchBody = {
  settlementMethod?: unknown;
  hourlyRate?: unknown;
  baseSalary?: unknown;
  cpsRateBps?: unknown;
  reason?: unknown;
};

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number`);
  }
  if (parsed < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
  return parsed;
}

function optionalInteger(value: unknown, fieldName: string) {
  const parsed = optionalNumber(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (allowedValues.includes(normalized as T)) {
    return normalized as T;
  }
  return NextResponse.json(
    { error: `${fieldName} is invalid` },
    { status: 400 },
  );
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
