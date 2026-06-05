import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listProjects } from "@/features/projects/project-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import ProjectsPage from "./page";

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

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("console projects route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the authenticated staff identity into the ops UI", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-owner",
      email: "owner@example.test",
      name: "Owner User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
    vi.mocked(listProjects).mockResolvedValue([]);

    render(await ProjectsPage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Owner User",
    );
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "projects",
        currentUser: expect.objectContaining({
          id: "user-owner",
          name: "Owner User",
          role: "owner",
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

    await expect(Promise.resolve().then(() => ProjectsPage())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(listProjects).not.toHaveBeenCalled();
  });
});
