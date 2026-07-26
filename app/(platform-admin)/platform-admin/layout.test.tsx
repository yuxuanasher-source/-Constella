import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPlatformAdminContext } from "@/features/platform-admin/platform-admin-auth";
import { getAuthenticatedUser } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import PlatformAdminLayout from "./layout";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-auth", () => ({
  getPlatformAdminContext: vi.fn(),
}));

describe("PlatformAdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: "admin-user",
      email: "admin@example.com",
    } as never);
    vi.mocked(getPlatformAdminContext).mockResolvedValue({
      userId: "admin-user",
      email: "admin@example.com",
      name: "平台管理员",
      role: "super_admin",
    });
  });

  it("redirects unauthenticated users to the dedicated login", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    await expect(
      PlatformAdminLayout({ children: <div>后台内容</div> }),
    ).rejects.toThrow("NEXT_REDIRECT:/platform-admin/login");
  });

  it("redirects authenticated non-admin users to the product entry", async () => {
    vi.mocked(getPlatformAdminContext).mockResolvedValue(null);

    await expect(
      PlatformAdminLayout({ children: <div>后台内容</div> }),
    ).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders the administration surface for an active super admin", async () => {
    render(await PlatformAdminLayout({ children: <div>后台内容</div> }));

    expect(screen.getByText("后台内容")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
