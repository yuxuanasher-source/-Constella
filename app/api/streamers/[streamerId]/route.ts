import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import {
  STREAMER_COOPERATION_STATUSES,
  STREAMER_SETTLEMENT_METHODS,
  STREAMER_SOURCE_TYPES,
  updateStreamerProfile,
  type StreamerCooperationStatus,
  type StreamerSettlementMethod,
  type StreamerSourceType,
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

    const body = (await request.json().catch(() => ({}))) as StreamerPatchBody;
    const sourceType = normalizeEnum(
      body.sourceType,
      STREAMER_SOURCE_TYPES,
      "sourceType",
    );
    const cooperationStatus = normalizeEnum(
      body.cooperationStatus,
      STREAMER_COOPERATION_STATUSES,
      "cooperationStatus",
    );
    const defaultSettlementMethod = normalizeEnum(
      body.defaultSettlementMethod,
      STREAMER_SETTLEMENT_METHODS,
      "defaultSettlementMethod",
    );
    if (sourceType instanceof Response) return sourceType;
    if (cooperationStatus instanceof Response) return cooperationStatus;
    if (defaultSettlementMethod instanceof Response) {
      return defaultSettlementMethod;
    }

    await assertBillingWriteAllowed({
      client: supabase,
      organizationId: auth.organizationId,
      featureKey: "project_management",
    });
    if (hasSettlementFields(body)) {
      await assertBillingWriteAllowed({
        client: supabase,
        organizationId: auth.organizationId,
        featureKey: "settlement",
      });
    }

    const { streamerId } = await params;
    const streamer = await updateStreamerProfile({
      repo: new SupabaseStreamerRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      streamerId,
      input: {
        displayName: normalizeOptionalText(body.displayName),
        realName: normalizeNullableTextField(body, "realName"),
        gender: normalizeNullableTextField(body, "gender"),
        sourceType: sourceType as StreamerSourceType | undefined,
        cooperationStatus: cooperationStatus as
          | StreamerCooperationStatus
          | undefined,
        categories: normalizeTextListField(body, "categories"),
        platforms: normalizeTextListField(body, "platforms"),
        styles: normalizeTextListField(body, "styles"),
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

type StreamerPatchBody = {
  displayName?: unknown;
  realName?: unknown;
  gender?: unknown;
  sourceType?: unknown;
  cooperationStatus?: unknown;
  categories?: unknown;
  platforms?: unknown;
  styles?: unknown;
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

function hasOwn(body: StreamerPatchBody, key: keyof StreamerPatchBody) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function normalizeNullableTextField(
  body: StreamerPatchBody,
  key: keyof StreamerPatchBody,
) {
  if (!hasOwn(body, key)) {
    return undefined;
  }
  const value = body[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim() || null;
}

function normalizeTextListField(
  body: StreamerPatchBody,
  key: keyof StreamerPatchBody,
) {
  if (!hasOwn(body, key)) {
    return undefined;
  }
  const value = body[key];
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n，]/)
      : [];
  const normalized = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized;
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

function hasSettlementFields(body: StreamerPatchBody) {
  return (
    body.defaultSettlementMethod !== undefined ||
    body.defaultHourlyRate !== undefined ||
    body.defaultBaseSalary !== undefined ||
    body.defaultCpsRateBps !== undefined
  );
}

function jsonServiceError(error: unknown) {
  const message = serviceErrorMessage(error);
  if (error instanceof Error) {
    return NextResponse.json(
      { error: message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

function serviceErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return "Unexpected error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
