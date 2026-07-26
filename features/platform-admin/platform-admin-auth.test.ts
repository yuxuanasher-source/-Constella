import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePlatformAdminContext } from "./platform-admin-auth";

function queryResult<T>(data: T) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function createClients(input?: {
  user?: { id: string; email?: string } | null;
  admin?: { role: string; status: string } | null;
  profile?: { full_name: string } | null;
}) {
  const sessionClient = {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user:
            input?.user === undefined
              ? { id: "admin-user", email: "admin@example.com" }
              : input.user,
        },
      })),
    },
  };
  const adminQuery = queryResult(
    input?.admin === undefined
      ? { role: "super_admin", status: "active" }
      : input.admin,
  );
  const profileQuery = queryResult(
    input?.profile === undefined
      ? { full_name: "平台管理员" }
      : input.profile,
  );
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  Object.assign(adminQuery, { update });

  const adminClient = {
    from: vi.fn((table: string) => {
      if (table === "platform_admins") {
        return adminQuery;
      }
      if (table === "profiles") {
        return profileQuery;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    sessionClient,
    adminClient,
    adminQuery,
    profileQuery,
    update,
    updateEq,
  };
}

describe("resolvePlatformAdminContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the real session identity and service-role lookups", async () => {
    const clients = createClients();

    const context = await resolvePlatformAdminContext({
      sessionClient: clients.sessionClient as never,
      adminClient: clients.adminClient as never,
      now: new Date("2026-07-25T08:00:00.000Z"),
    });

    expect(context).toEqual({
      userId: "admin-user",
      email: "admin@example.com",
      name: "平台管理员",
      role: "super_admin",
    });
    expect(clients.adminClient.from).toHaveBeenCalledWith("platform_admins");
    expect(clients.adminClient.from).toHaveBeenCalledWith("profiles");
    expect(clients.update).toHaveBeenCalledWith({
      last_access_at: "2026-07-25T08:00:00.000Z",
    });
    expect(clients.updateEq).toHaveBeenCalledWith("user_id", "admin-user");
  });

  it("rejects an unauthenticated session before using the admin client", async () => {
    const clients = createClients({ user: null });

    await expect(
      resolvePlatformAdminContext({
        sessionClient: clients.sessionClient as never,
        adminClient: clients.adminClient as never,
      }),
    ).resolves.toBeNull();

    expect(clients.adminClient.from).not.toHaveBeenCalled();
  });

  it("rejects a user without a platform-admin record", async () => {
    const clients = createClients({ admin: null });

    await expect(
      resolvePlatformAdminContext({
        sessionClient: clients.sessionClient as never,
        adminClient: clients.adminClient as never,
      }),
    ).resolves.toBeNull();

    expect(clients.adminClient.from).not.toHaveBeenCalledWith("profiles");
  });

  it("rejects a suspended platform administrator", async () => {
    const clients = createClients({
      admin: { role: "super_admin", status: "suspended" },
    });

    await expect(
      resolvePlatformAdminContext({
        sessionClient: clients.sessionClient as never,
        adminClient: clients.adminClient as never,
      }),
    ).resolves.toBeNull();

    expect(clients.update).not.toHaveBeenCalled();
  });

  it("rejects missing clients without throwing", async () => {
    await expect(
      resolvePlatformAdminContext({
        sessionClient: null,
        adminClient: null,
      }),
    ).resolves.toBeNull();
  });
});
