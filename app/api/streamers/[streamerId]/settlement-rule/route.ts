import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import {
  STREAMER_SETTLEMENT_METHODS,
  updateStreamerSettlementRule,
  type StreamerSettlementMethod,
} from "@/features/streamers/streamer-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
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

    const { streamerId } = await params;
    const body = (await request.json().catch(() => ({}))) as StreamerSettlementPatchBody;
    const defaultSettlementMethod = normalizeEnum(
      body.defaultSettlementMethod,
      STREAMER_SETTLEMENT_METHODS,
      "defaultSettlementMethod",
    );
    if (defaultSettlementMethod instanceof Response) {
      return defaultSettlementMethod;
    }

    const streamer = await updateStreamerSettlementRule({
      repo: new SupabaseStreamerRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      streamerId,
      input: {
        defaultSettlementMethod: defaultSettlementMethod as
          | StreamerSettlementMethod
          | undefined,
        defaultHourlyRate: optionalNumber(
          body.defaultHourlyRate,
          "defaultHourlyRate",
        ),
        defaultBaseSalary: optionalNumber(
          body.defaultBaseSalary,
          "defaultBaseSalary",
        ),
        defaultCpsRateBps: optionalInteger(
          body.defaultCpsRateBps,
          "defaultCpsRateBps",
        ),
      },
      reason: normalizeOptionalText(body.reason) ?? "",
    });

    return NextResponse.json({ streamer });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type StreamerSettlementPatchBody = {
  defaultSettlementMethod?: unknown;
  defaultHourlyRate?: unknown;
  defaultBaseSalary?: unknown;
  defaultCpsRateBps?: unknown;
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
