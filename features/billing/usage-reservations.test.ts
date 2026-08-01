import { describe, expect, it, vi } from "vitest";

import {
  consumeUsageReservation,
  listStaleUsageReservations,
  markStaleUsageReservationReviewed,
  releaseUsageReservation,
  resetStaleUsageReservationReview,
  reserveUsageReservation,
} from "./usage-reservations";

function createClient(errorByRpc: Record<string, Error> = {}) {
  return {
    rpc: vi.fn(
      async (
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: Error | null }> => ({
        data: errorByRpc[name]
          ? null
          : { id: args.p_reservation_id, status: "reserved" },
        error: errorByRpc[name] ?? null,
      }),
    ),
  };
}

describe("usage reservations", () => {
  it("consumes a reservation through the controlled RPC", async () => {
    const client = createClient();

    await consumeUsageReservation({
      client,
      reservationId: "job-1",
      metadata: { provider: "tencent_ocr", attempt: 1 },
    });

    expect(client.rpc).toHaveBeenCalledWith("consume_usage_reservation", {
      p_reservation_id: "job-1",
      p_metadata: { provider: "tencent_ocr", attempt: 1 },
    });
  });

  it("releases a reservation without leaking an exception message into the reason", async () => {
    const client = createClient();

    await releaseUsageReservation({
      client,
      reservationId: "job-2",
      reason: "image_source_failed",
    });

    expect(client.rpc).toHaveBeenCalledWith("release_usage_reservation", {
      p_reservation_id: "job-2",
      p_reason: "image_source_failed",
    });
  });

  it("surfaces reservation RPC failures instead of silently continuing", async () => {
    const client = createClient({
      consume_usage_reservation: new Error("reservation write failed"),
    });

    await expect(
      consumeUsageReservation({
        client,
        reservationId: "job-3",
        metadata: {},
      }),
    ).rejects.toThrow("reservation write failed");
  });

  it("re-arms a released reservation through the controlled RPC", async () => {
    const client = createClient();

    await expect(
      reserveUsageReservation({ client, reservationId: "job-4" }),
    ).resolves.toBe("reserved");
    expect(client.rpc).toHaveBeenCalledWith("reserve_usage_reservation", {
      p_reservation_id: "job-4",
    });
  });

  it("maps re-arm quota failures to the stable hard-block error", async () => {
    const client = createClient({
      reserve_usage_reservation: new Error("P0001 OCR_USAGE_LIMIT_REACHED"),
    });

    await expect(
      reserveUsageReservation({ client, reservationId: "job-5" }),
    ).rejects.toMatchObject({
      name: "UsageHardBlockError",
      message: "OCR usage limit reached",
    });
  });

  it("lists only the minimal stale reservation review fields", async () => {
    const client = createClient();
    vi.mocked(client.rpc).mockResolvedValueOnce({
      data: [
        {
          reservation_id: "reservation-1",
          organization_id: "org-1",
          source: "ocr_job",
          reserved_at: "2026-07-29T08:00:00.000Z",
          last_reviewed_at: null,
          age_seconds: 100_000,
        },
      ],
      error: null,
    });

    await expect(
      listStaleUsageReservations({
        client,
        before: "2026-07-30T08:00:00.000Z",
        limit: 100,
      }),
    ).resolves.toEqual([
      {
        reservationId: "reservation-1",
        organizationId: "org-1",
        source: "ocr_job",
        reservedAt: "2026-07-29T08:00:00.000Z",
        lastReviewedAt: null,
        ageSeconds: 100_000,
      },
    ]);
    expect(client.rpc).toHaveBeenCalledWith("list_stale_usage_reservations", {
      p_before: "2026-07-30T08:00:00.000Z",
      p_limit: 100,
    });
    expect(
      JSON.stringify(await vi.mocked(client.rpc).mock.results[0]?.value),
    ).not.toContain("metadata");
  });

  it("marks a stale reservation only against the listed attempt and review version", async () => {
    const client = createClient();
    vi.mocked(client.rpc).mockResolvedValueOnce({
      data: [
        {
          reservation_id: "reservation-1",
          organization_id: "org-1",
          source: "ocr_job",
          reserved_at: "2026-07-29T08:00:00.000Z",
          previous_reviewed_at: null,
          reviewed_at: "2026-07-31T12:00:00.000Z",
          age_seconds: 187_200,
        },
      ],
      error: null,
    });

    await expect(
      markStaleUsageReservationReviewed({
        client,
        reservationId: "reservation-1",
        expectedReservedAt: "2026-07-29T08:00:00.000Z",
        expectedLastReviewedAt: null,
        before: "2026-07-30T12:00:00.000Z",
      }),
    ).resolves.toEqual({
      reservationId: "reservation-1",
      organizationId: "org-1",
      source: "ocr_job",
      reservedAt: "2026-07-29T08:00:00.000Z",
      previousReviewedAt: null,
      reviewedAt: "2026-07-31T12:00:00.000Z",
      ageSeconds: 187_200,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "mark_stale_usage_reservation_reviewed",
      {
        p_reservation_id: "reservation-1",
        p_expected_reserved_at: "2026-07-29T08:00:00.000Z",
        p_expected_last_reviewed_at: null,
        p_before: "2026-07-30T12:00:00.000Z",
      },
    );
  });

  it("returns null when a concurrent state change prevents review marking", async () => {
    const client = createClient();
    vi.mocked(client.rpc).mockResolvedValueOnce({ data: [], error: null });

    await expect(
      markStaleUsageReservationReviewed({
        client,
        reservationId: "reservation-race",
        expectedReservedAt: "2026-07-29T08:00:00.000Z",
        expectedLastReviewedAt: null,
        before: "2026-07-30T12:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("conditionally restores review progression after an audit failure", async () => {
    const client = createClient();
    vi.mocked(client.rpc).mockResolvedValueOnce({ data: true, error: null });

    await expect(
      resetStaleUsageReservationReview({
        client,
        reservationId: "reservation-1",
        expectedReservedAt: "2026-07-29T08:00:00.000Z",
        failedReviewedAt: "2026-07-31T12:00:00.000Z",
        previousReviewedAt: null,
      }),
    ).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "reset_stale_usage_reservation_review",
      {
        p_reservation_id: "reservation-1",
        p_expected_reserved_at: "2026-07-29T08:00:00.000Z",
        p_failed_reviewed_at: "2026-07-31T12:00:00.000Z",
        p_previous_reviewed_at: null,
      },
    );
  });

  it("rejects malformed stale reservation RPC rows", async () => {
    const client = createClient();
    vi.mocked(client.rpc).mockResolvedValueOnce({
      data: [{ reservation_id: "reservation-1", metadata: { secret: true } }],
      error: null,
    });

    await expect(
      listStaleUsageReservations({
        client,
        before: "2026-07-30T08:00:00.000Z",
        limit: 100,
      }),
    ).rejects.toThrow("invalid payload");
  });
});
