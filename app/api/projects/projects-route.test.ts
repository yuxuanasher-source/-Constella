import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  createProjectDraft,
  createProjectAuditWriter,
  publishProject,
} from "@/features/projects/project-service";
import { listProjects } from "@/features/projects/project-queries";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/projects/project-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/projects/project-service")
  >("@/features/projects/project-service");
  return {
    ...actual,
    createProjectAuditWriter: vi.fn(),
    createProjectDraft: vi.fn(),
    publishProject: vi.fn(),
  };
});

const supabase = { client: "supabase" };
const audit = vi.fn();
const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

function jsonRequest(body: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/api/projects", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("project api routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
    vi.mocked(createProjectAuditWriter).mockReturnValue(audit);
  });

  it("GET /api/projects returns UI DTOs", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      {
        id: "p1",
        code: "P2412",
        name: "鸣潮暑期招募",
        status: "draft",
        sensitivity: "normal",
        force_system_timing: true,
        default_hourly_rate: 4500,
        published_at: null,
        created_at: "2026-06-01T09:00:00.000Z",
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: [
        expect.objectContaining({
          id: "p1",
          code: "P2412",
          statusLabel: "草稿",
        }),
      ],
    });
  });

  it("POST /api/projects creates a draft through the audited service", async () => {
    vi.mocked(createProjectDraft).mockResolvedValue({
      id: "p1",
      name: "鸣潮暑期招募",
      code: "P2412",
      status: "draft",
      organization_id: "org-1",
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest({ name: "鸣潮暑期招募", code: "P2412" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      project: expect.objectContaining({ id: "p1", status: "draft" }),
    });
    expect(createProjectDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        audit,
        actor: auth,
        input: { name: "鸣潮暑期招募", code: "P2412", supplierId: undefined },
      }),
    );
  });

  it("POST /api/projects/[projectId]/publish publishes through the audited service", async () => {
    vi.mocked(publishProject).mockResolvedValue({
      id: "p1",
      name: "鸣潮暑期招募",
      code: "P2412",
      status: "recruiting",
      organization_id: "org-1",
    } as never);

    const { POST } = await import("./[projectId]/publish/route");
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "p1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: expect.objectContaining({ id: "p1", status: "recruiting" }),
    });
    expect(publishProject).toHaveBeenCalledWith(
      expect.objectContaining({
        audit,
        actor: auth,
        projectId: "p1",
      }),
    );
  });
});
