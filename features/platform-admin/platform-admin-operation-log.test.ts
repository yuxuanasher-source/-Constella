import { describe, expect, it } from "vitest";

import {
  hashPlatformAdminRequest,
  redactPlatformAdminPayload,
} from "./platform-admin-operation-log";

describe("platform-admin operation log safety", () => {
  it("hashes canonical JSON independently of object key order", () => {
    expect(
      hashPlatformAdminRequest({
        organizationId: "org-1",
        settings: { plan: "pro", seats: 12 },
      }),
    ).toBe(
      hashPlatformAdminRequest({
        settings: { seats: 12, plan: "pro" },
        organizationId: "org-1",
      }),
    );
  });

  it("redacts secrets recursively without removing safe audit fields", () => {
    expect(
      redactPlatformAdminPayload({
        email: "admin@example.com",
        password: "secret-password",
        providerPayload: { card: "raw-card-data" },
        nested: {
          serviceRoleKey: "service-secret",
          refresh_token: "raw-token",
          reason: "续费",
        },
      }),
    ).toEqual({
      email: "admin@example.com",
      password: "[REDACTED]",
      providerPayload: "[REDACTED]",
      nested: {
        serviceRoleKey: "[REDACTED]",
        refresh_token: "[REDACTED]",
        reason: "续费",
      },
    });
  });
});
