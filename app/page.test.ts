import { describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import Home from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("home route", () => {
  it("sends visitors to the login config notice when Supabase is unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    await expect(Promise.resolve().then(() => Home())).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=config",
    );
  });

  it("sends unauthenticated visitors to login instead of the ops console", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    await expect(Promise.resolve().then(() => Home())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
  });
});
