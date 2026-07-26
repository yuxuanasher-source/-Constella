import WebSocket from "ws";

import { describe, expect, it, vi } from "vitest";

import { createPlatformAdminClient } from "./platform-admin-client.mjs";

describe("createPlatformAdminClient", () => {
  it("injects the ws transport required by Node.js 20", () => {
    const expectedClient = {};
    const clientFactory = vi.fn(() => expectedClient);

    const client = createPlatformAdminClient(
      "https://example.supabase.co",
      "service-role-key",
      clientFactory,
    );

    expect(client).toBe(expectedClient);
    expect(clientFactory).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        realtime: {
          transport: WebSocket,
        },
      },
    );
  });
});
