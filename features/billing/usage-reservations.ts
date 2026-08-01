type UsageReservationClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export type StaleUsageReservation = {
  reservationId: string;
  organizationId: string;
  source: string;
  reservedAt: string;
  lastReviewedAt: string | null;
  ageSeconds: number;
};

export type ReviewedStaleUsageReservation = {
  reservationId: string;
  organizationId: string;
  source: string;
  reservedAt: string;
  previousReviewedAt: string | null;
  reviewedAt: string;
  ageSeconds: number;
};

export class UsageHardBlockError extends Error {
  readonly code = "usage_limit_reached";

  constructor() {
    super("OCR usage limit reached");
    this.name = "UsageHardBlockError";
  }
}

export function isOcrUsageLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  return [candidate.message, candidate.details, candidate.hint].some(
    (value) =>
      typeof value === "string" && value.includes("OCR_USAGE_LIMIT_REACHED"),
  );
}

export async function consumeUsageReservation({
  client,
  reservationId,
  metadata,
}: {
  client: UsageReservationClient;
  reservationId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { error } = await client.rpc("consume_usage_reservation", {
    p_reservation_id: reservationId,
    p_metadata: metadata,
  });
  if (error) {
    throw error;
  }
}

export async function reserveUsageReservation({
  client,
  reservationId,
}: {
  client: UsageReservationClient;
  reservationId: string;
}): Promise<"reserved" | "consumed"> {
  const { data, error } = await client.rpc("reserve_usage_reservation", {
    p_reservation_id: reservationId,
  });
  if (error) {
    if (isOcrUsageLimitError(error)) {
      throw new UsageHardBlockError();
    }
    throw error;
  }
  const status =
    data && typeof data === "object"
      ? (data as { status?: unknown }).status
      : undefined;
  if (status !== "reserved" && status !== "consumed") {
    throw new Error("Usage reservation RPC returned an invalid status");
  }
  return status;
}

export async function releaseUsageReservation({
  client,
  reservationId,
  reason,
}: {
  client: UsageReservationClient;
  reservationId: string;
  reason: string;
}): Promise<void> {
  const { error } = await client.rpc("release_usage_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });
  if (error) {
    throw error;
  }
}

export async function listStaleUsageReservations({
  client,
  before,
  limit,
}: {
  client: UsageReservationClient;
  before: string;
  limit: number;
}): Promise<StaleUsageReservation[]> {
  const { data, error } = await client.rpc("list_stale_usage_reservations", {
    p_before: before,
    p_limit: limit,
  });
  if (error) {
    throw error;
  }
  if (!Array.isArray(data)) {
    throw new Error("Stale usage reservation RPC returned an invalid payload");
  }

  return data.map(parseStaleUsageReservation);
}

export async function markStaleUsageReservationReviewed({
  client,
  reservationId,
  expectedReservedAt,
  expectedLastReviewedAt,
  before,
}: {
  client: UsageReservationClient;
  reservationId: string;
  expectedReservedAt: string;
  expectedLastReviewedAt: string | null;
  before: string;
}): Promise<ReviewedStaleUsageReservation | null> {
  const { data, error } = await client.rpc(
    "mark_stale_usage_reservation_reviewed",
    {
      p_reservation_id: reservationId,
      p_expected_reserved_at: expectedReservedAt,
      p_expected_last_reviewed_at: expectedLastReviewedAt,
      p_before: before,
    },
  );
  if (error) {
    throw error;
  }
  if (!Array.isArray(data) || data.length > 1) {
    throw new Error(
      "Stale usage reservation mark RPC returned an invalid payload",
    );
  }
  if (data.length === 0) {
    return null;
  }

  const row = requireRecord(
    data[0],
    "Stale usage reservation mark RPC returned an invalid payload",
  );
  const common = parseStaleUsageReservation({
    ...row,
    last_reviewed_at: row.previous_reviewed_at,
  });
  if (!isTimestamp(row.reviewed_at)) {
    throw new Error(
      "Stale usage reservation mark RPC returned an invalid payload",
    );
  }
  return {
    reservationId: common.reservationId,
    organizationId: common.organizationId,
    source: common.source,
    reservedAt: common.reservedAt,
    previousReviewedAt: common.lastReviewedAt,
    reviewedAt: row.reviewed_at,
    ageSeconds: common.ageSeconds,
  };
}

export async function resetStaleUsageReservationReview({
  client,
  reservationId,
  expectedReservedAt,
  failedReviewedAt,
  previousReviewedAt,
}: {
  client: UsageReservationClient;
  reservationId: string;
  expectedReservedAt: string;
  failedReviewedAt: string;
  previousReviewedAt: string | null;
}): Promise<boolean> {
  const { data, error } = await client.rpc(
    "reset_stale_usage_reservation_review",
    {
      p_reservation_id: reservationId,
      p_expected_reserved_at: expectedReservedAt,
      p_failed_reviewed_at: failedReviewedAt,
      p_previous_reviewed_at: previousReviewedAt,
    },
  );
  if (error) {
    throw error;
  }
  if (typeof data !== "boolean") {
    throw new Error(
      "Stale usage reservation reset RPC returned an invalid payload",
    );
  }
  return data;
}

function parseStaleUsageReservation(value: unknown): StaleUsageReservation {
  const message = "Stale usage reservation RPC returned an invalid payload";
  const row = requireRecord(value, message);
  const ageSeconds = Number(row.age_seconds);
  if (
    typeof row.reservation_id !== "string" ||
    !row.reservation_id ||
    typeof row.organization_id !== "string" ||
    !row.organization_id ||
    typeof row.source !== "string" ||
    !row.source ||
    !isTimestamp(row.reserved_at) ||
    (row.last_reviewed_at !== null && !isTimestamp(row.last_reviewed_at)) ||
    !Number.isSafeInteger(ageSeconds) ||
    ageSeconds < 0
  ) {
    throw new Error(message);
  }
  return {
    reservationId: row.reservation_id,
    organizationId: row.organization_id,
    source: row.source,
    reservedAt: row.reserved_at,
    lastReviewedAt: row.last_reviewed_at,
    ageSeconds,
  };
}

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}
