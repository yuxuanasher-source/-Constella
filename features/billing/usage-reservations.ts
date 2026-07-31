type UsageReservationClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
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
