import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import ConsolePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn((props: { currentUser?: { name?: string } }) => (
    <div data-testid="ops-reference-app">
      {props.currentUser?.name ?? "missing-user"}
    </div>
  )),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("console route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the authenticated staff identity into the ops UI", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ops",
      email: "alice@example.test",
      name: "Alice Ops",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "ops_manager",
    });

    render(await ConsolePage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Alice Ops",
    );
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "warroom",
        currentUser: expect.objectContaining({
          id: "user-ops",
          name: "Alice Ops",
          role: "ops_manager",
          dept: "Demo Org",
        }),
        organizationSettings: expect.objectContaining({
          name: "Demo Org",
        }),
      }),
      undefined,
    );
  });

  it("redirects unauthenticated visitors to login", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    await expect(Promise.resolve().then(() => ConsolePage())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
  });
});
