import { describe, expect, it, vi } from "vitest";

import { grantPlatformAdmin } from "./grant-platform-admin";

function createClient(
  profiles: Array<{ id: string; email: string }> = [
    { id: "profile-1", email: "admin@example.com" },
  ],
) {
  const ilike = vi.fn(async () => ({ data: profiles, error: null }));
  const select = vi.fn(() => ({ ilike }));
  const upsert = vi.fn(async () => ({ error: null }));
  const client = {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select };
      }
      if (table === "platform_admins") {
        return { upsert };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { client, select, ilike, upsert };
}

describe("grantPlatformAdmin", () => {
  it("grants the matching profile active super-admin access", async () => {
    const { client, upsert } = createClient();

    await expect(
      grantPlatformAdmin({
        client: client as never,
        email: " Admin@Example.com ",
      }),
    ).resolves.toEqual({
      email: "admin@example.com",
      userId: "profile-1",
    });

    expect(client.from).toHaveBeenCalledWith("platform_admins");
    expect(upsert).toHaveBeenCalledWith({
      user_id: "profile-1",
      role: "super_admin",
      status: "active",
    });
  });

  it("rejects an email without a profile", async () => {
    const { client, upsert } = createClient([]);

    await expect(
      grantPlatformAdmin({
        client: client as never,
        email: "missing@example.com",
      }),
    ).rejects.toThrow("No profile found");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects ambiguous case-insensitive profile matches", async () => {
    const { client, upsert } = createClient([
      { id: "profile-1", email: "admin@example.com" },
      { id: "profile-2", email: "Admin@example.com" },
    ]);

    await expect(
      grantPlatformAdmin({
        client: client as never,
        email: "admin@example.com",
      }),
    ).rejects.toThrow("Multiple profiles found");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("requires an email", async () => {
    const { client } = createClient();

    await expect(
      grantPlatformAdmin({
        client: client as never,
        email: " ",
      }),
    ).rejects.toThrow("Email is required");
  });
});
