import { NextResponse } from "next/server";

import { listStreamerPool } from "@/features/streamers/streamer-queries";
import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import {
  createStreamerProfile,
  STREAMER_SETTLEMENT_METHODS,
  STREAMER_SOURCE_TYPES,
  type StreamerSettlementMethod,
  type StreamerSourceType,
} from "@/features/streamers/streamer-service";
import { toStreamerCardDtos } from "@/features/streamers/streamer-ui-dto";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const streamers = await listStreamerPool(supabase);
    return NextResponse.json({ streamers: toStreamerCardDtos(streamers) });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as StreamerPostBody;
    const displayName = normalizeOptionalText(body.displayName);
    if (!displayName) {
      return NextResponse.json(
        { error: "displayName is required" },
        { status: 400 },
      );
    }
    const sourceType = normalizeEnum(
      body.sourceType,
      STREAMER_SOURCE_TYPES,
      "sourceType",
    );
    const defaultSettlementMethod = normalizeEnum(
      body.defaultSettlementMethod,
      STREAMER_SETTLEMENT_METHODS,
      "defaultSettlementMethod",
    );
    if (sourceType instanceof Response) {
      return sourceType;
    }
    if (defaultSettlementMethod instanceof Response) {
      return defaultSettlementMethod;
    }

    const streamer = await createStreamerProfile({
      repo: new SupabaseStreamerRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      input: {
        displayName,
        realName: normalizeOptionalText(body.realName),
        gender: normalizeOptionalText(body.gender),
        sourceType: sourceType as StreamerSourceType | undefined,
        categories: normalizeTextList(body.categories),
        platforms: normalizeTextList(body.platforms),
        styles: normalizeTextList(body.styles),
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
        userId: normalizeOptionalText(body.userId),
      },
    });

    return NextResponse.json({ streamer }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type StreamerPostBody = {
  displayName?: unknown;
  userId?: unknown;
  realName?: unknown;
  gender?: unknown;
  sourceType?: unknown;
  categories?: unknown;
  platforms?: unknown;
  styles?: unknown;
  defaultSettlementMethod?: unknown;
  defaultHourlyRate?: unknown;
  defaultBaseSalary?: unknown;
  defaultCpsRateBps?: unknown;
};

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTextList(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n，]/)
      : [];
  const normalized = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
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
