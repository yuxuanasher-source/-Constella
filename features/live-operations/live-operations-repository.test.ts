import { describe, expect, it, vi } from "vitest";

import { getStreamerIdForUser } from "./live-operations-repository";

describe("getStreamerIdForUser", () => {
  it("selects one streamer binding within the current organization", async () => {
    const limit = vi.fn(async () => ({
      data: [{ id: "streamer-latest" }],
      error: null,
    }));
    const orderId = vi.fn(() => ({ limit }));
    const orderCreatedAt = vi.fn(() => ({ order: orderId }));
    const eqOrganization = vi.fn(() => ({ order: orderCreatedAt }));
    const eqUser = vi.fn(() => ({ eq: eqOrganization }));
    const select = vi.fn(() => ({ eq: eqUser }));
    const from = vi.fn(() => ({ select }));

    await expect(
      getStreamerIdForUser({ from } as never, "user-streamer", "org-1"),
    ).resolves.toBe("streamer-latest");
    expect(from).toHaveBeenCalledWith("streamers");
    expect(select).toHaveBeenCalledWith("id");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-streamer");
    expect(eqOrganization).toHaveBeenCalledWith("organization_id", "org-1");
    expect(orderCreatedAt).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(orderId).toHaveBeenCalledWith("id", { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
  });
});
