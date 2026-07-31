import { describe, expect, it, vi } from "vitest";

import {
  consumeUsageReservation,
  releaseUsageReservation,
  reserveUsageReservation,
} from "./usage-reservations";

function createClient(errorByRpc: Record<string, Error> = {}) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
      data: errorByRpc[name]
        ? null
        : { id: args.p_reservation_id, status: "reserved" },
      error: errorByRpc[name] ?? null,
    })),
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
});
