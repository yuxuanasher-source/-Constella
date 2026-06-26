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
import { parseListPagination } from "@/lib/http/pagination";
import { withAuth } from "@/lib/http/route-handler";

export const GET = withAuth(async ({ supabase, request }) => {
  const streamers = await listStreamerPool(
    supabase,
    parseListPagination(request.url),
  );
  return NextResponse.json({ streamers: toStreamerCardDtos(streamers) });
});

export const POST = withAuth(async ({ supabase, auth, request }) => {
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
      userId: normalizeOptionalText(body.userId),
    },
  });

  return NextResponse.json({ streamer }, { status: 201 });
});

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
