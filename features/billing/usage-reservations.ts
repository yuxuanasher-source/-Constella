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
  createdAt: string;
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

  return data.map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Stale usage reservation RPC returned an invalid payload");
    }
    const row = value as Record<string, unknown>;
    const ageSeconds = Number(row.age_seconds);
    if (
      typeof row.reservation_id !== "string" ||
      !row.reservation_id ||
      typeof row.organization_id !== "string" ||
      !row.organization_id ||
      typeof row.source !== "string" ||
      !row.source ||
      typeof row.created_at !== "string" ||
      !row.created_at ||
      !Number.isSafeInteger(ageSeconds) ||
      ageSeconds < 0
    ) {
      throw new Error("Stale usage reservation RPC returned an invalid payload");
    }
    return {
      reservationId: row.reservation_id,
      organizationId: row.organization_id,
      source: row.source,
      createdAt: row.created_at,
      ageSeconds,
    };
  });
}
