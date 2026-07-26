import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePlatformAdminContext } from "@/features/platform-admin/platform-admin-auth";
import { getAuthenticatedUser } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

import { getPlatformAdminRouteContext } from "./route-context";

vi.mock("@/features/platform-admin/platform-admin-auth", () => ({
  resolvePlatformAdminContext: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

describe("getPlatformAdminRouteContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "session",
    } as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: "admin-user",
      email: "admin@example.com",
    } as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin",
    } as never);
    vi.mocked(resolvePlatformAdminContext).mockResolvedValue({
      userId: "admin-user",
      email: "admin@example.com",
      name: "平台管理员",
      role: "super_admin",
    });
  });

  it("returns 401 without a session client", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    await expect(getPlatformAdminRouteContext()).resolves.toEqual({
      ok: false,
      status: 401,
    });
  });

  it("returns 401 without an authenticated user", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    await expect(getPlatformAdminRouteContext()).resolves.toEqual({
      ok: false,
      status: 401,
    });
  });

  it("returns 503 without a service-role client", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    await expect(getPlatformAdminRouteContext()).resolves.toEqual({
      ok: false,
      status: 503,
    });
  });

  it("returns 403 for an authenticated non-admin", async () => {
    vi.mocked(resolvePlatformAdminContext).mockResolvedValue(null);

    await expect(getPlatformAdminRouteContext()).resolves.toEqual({
      ok: false,
      status: 403,
    });
  });

  it("returns an isolated repository for an active administrator", async () => {
    const context = await getPlatformAdminRouteContext();

    expect(context).toMatchObject({
      ok: true,
      actor: { userId: "admin-user", role: "super_admin" },
      admin: { client: "admin" },
    });
    if (context.ok) {
      expect(context.repo.constructor.name).toBe(
        "SupabasePlatformAdminRepository",
      );
    }
  });
});
