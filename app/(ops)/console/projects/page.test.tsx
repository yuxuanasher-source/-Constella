import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleProjectsWorkbench } from "@/components/console/projects-workbench";
import { OpsShell } from "@/components/layouts/ops-shell";
import { listOpsApplicationQueue } from "@/features/applications/application-queries";
import { listProjects } from "@/features/projects/project-queries";
import {
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
} from "@/features/collaborations/project-collaboration-service";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

import ProjectsPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/layouts/ops-shell", () => ({
  OpsShell: vi.fn(
    ({
      children,
      activeHref,
    }: {
      children: React.ReactNode;
      activeHref?: string;
    }) => (
      <div data-active-href={activeHref} data-testid="ops-shell">
        {children}
      </div>
    ),
  ),
}));

vi.mock("@/components/console/projects-workbench", () => ({
  ConsoleProjectsWorkbench: vi.fn(
    ({
      currentUser,
      projectCards,
    }: {
      currentUser?: { name?: string };
      projectCards: unknown[];
    }) => (
      <div data-testid="projects-workbench">
        {currentUser?.name ?? "missing-user"} · {projectCards.length}
      </div>
    ),
  ),
}));

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn(() => <div data-testid="ops-reference-app" />),
}));

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/applications/application-queries", () => ({
  listOpsApplicationQueue: vi.fn(),
}));

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return {
        type: "collaboration-repo",
      };
    }),
  listPartnerCollaborationApplications: vi.fn(),
  listPartnerCollaborationProjects: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

describe("console projects route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin-supabase",
    } as never);
    vi.mocked(listOpsApplicationQueue).mockResolvedValue([]);
    vi.mocked(listPartnerCollaborationApplications).mockResolvedValue([]);
    vi.mocked(listPartnerCollaborationProjects).mockResolvedValue([]);
  });

  it("renders projects through the ops shell instead of the legacy reference app", async () => {
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
    vi.mocked(listProjects).mockResolvedValue([
      {
        id: "project-1",
        code: "P-001",
        name: "Launch Project",
        status: "active",
        sensitivity: "low",
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-31T00:00:00.000Z",
        open_signup: true,
        allow_direct_invite: true,
        force_recording: true,
        force_system_timing: true,
        default_hourly_rate: 12000,
        is_public_to_streamers: true,
        public_summary: "Public summary",
        game_download_url: null,
        is_open_to_mcn_collaboration: false,
        mcn_collaboration_summary: "",
        mcn_collaboration_terms: {},
        published_at: "2026-07-01T00:00:00.000Z",
        created_at: "2026-06-20T00:00:00.000Z",
      },
    ]);

    render(await ProjectsPage());

    expect(screen.getByTestId("ops-shell")).toHaveAttribute(
      "data-active-href",
      "/console/projects",
    );
    expect(screen.getByTestId("projects-workbench")).toHaveTextContent(
      "Owner User · 1",
    );
    expect(screen.queryByTestId("ops-reference-app")).not.toBeInTheDocument();
    expect(ConsoleProjectsWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUser: expect.objectContaining({
          id: "user-owner",
          name: "Owner User",
          role: "owner",
          dept: "Demo Org",
        }),
        applicationQueue: [],
        collaborationProjectCards: [],
      }),
      undefined,
    );
    expect(OpsShell).toHaveBeenCalledWith(
      expect.objectContaining({
        activeHref: "/console/projects",
        unreadCount: 0,
      }),
      undefined,
    );
    expect(listProjects).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
    });
    expect(listOpsApplicationQueue).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
    });
  });

  it("still renders when partner collaboration loading fails", async () => {
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
    vi.mocked(listPartnerCollaborationProjects).mockRejectedValue(
      new TypeError("Cannot convert argument to a ByteString"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(await ProjectsPage());

    expect(screen.getByTestId("projects-workbench")).toBeInTheDocument();
    expect(ConsoleProjectsWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({ collaborationProjectCards: [] }),
      undefined,
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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
