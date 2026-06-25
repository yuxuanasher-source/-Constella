import { describe, expect, it, vi } from "vitest";

import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { POST } from "./route";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("auth signout route", () => {
  it("signs out the current session and redirects to login", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signOut },
    } as never);

    const response = await POST(
      new Request("http://localhost/api/auth/signout"),
    );

    expect(signOut).toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});
