import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPlatformAdminContext } from "@/features/platform-admin/platform-admin-auth";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { platformAdminSignInAction } from "./actions";

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

vi.mock("@/features/platform-admin/platform-admin-auth", () => ({
  getPlatformAdminContext: vi.fn(),
}));

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("platformAdminSignInAction", () => {
  const signInWithPassword = vi.fn();
  const signOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    signInWithPassword.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword, signOut },
    } as never);
    vi.mocked(getPlatformAdminContext).mockResolvedValue({
      userId: "admin-user",
      email: "admin@example.com",
      name: "平台管理员",
      role: "super_admin",
    });
  });

  it("signs in and redirects an authorized administrator", async () => {
    await expect(
      platformAdminSignInAction(
        formData({ email: "admin@example.com", password: "secret123" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/platform-admin/organizations");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "secret123",
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("redirects invalid credentials back to the dedicated login", async () => {
    signInWithPassword.mockResolvedValue({
      error: new Error("Invalid login credentials"),
    });

    await expect(
      platformAdminSignInAction(
        formData({ email: "admin@example.com", password: "wrong" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/platform-admin/login?error=auth");

    expect(getPlatformAdminContext).not.toHaveBeenCalled();
  });

  it("signs out an authenticated user without platform access", async () => {
    vi.mocked(getPlatformAdminContext).mockResolvedValue(null);

    await expect(
      platformAdminSignInAction(
        formData({ email: "member@example.com", password: "secret123" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/platform-admin/login?error=forbidden");

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("reports missing Supabase configuration", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    await expect(
      platformAdminSignInAction(
        formData({ email: "admin@example.com", password: "secret123" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/platform-admin/login?error=config");
  });
});
