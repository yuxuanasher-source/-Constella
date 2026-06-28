import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAiDraft } from "@/features/ai/draft-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/features/ai/draft-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/ai/draft-repository")
  >("@/features/ai/draft-repository");
  return { ...actual, createAiDraft: vi.fn() };
});

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/drafts/suggested-action", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function suggestedAction() {
  return {
    actionId: "p-low-margin:margin-review",
    projectId: "p-low-margin",
    projectName: "Nova Launch",
    priority: "high",
    title: "Review margin and cost assumptions",
    rationale: "The project has margin signals that need a human review.",
    evidence: [
      {
        sourceTool: "role_home_dashboard",
        sourceId: "panel:projectRanking:rank:p-low-margin",
      },
    ],
    target: { route: "project", id: "p-low-margin" },
    requiresHumanApproval: true,
  };
}

describe("POST /api/ai/drafts/suggested-action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
    vi.mocked(createAiDraft).mockResolvedValue({ id: "draft-action-1" });
  });

  it("persists a suggested action as a pending todo draft", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ action: suggestedAction() }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createAiDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        actingUserId: "user-owner",
        envelope: expect.objectContaining({
          draftType: "suggested_action_todo",
          status: "pending",
          payload: expect.objectContaining({
            sourceActionId: "p-low-margin:margin-review",
            title: "Review margin and cost assumptions",
            projectName: "Nova Launch",
          }),
        }),
      }),
    );
    expect(body.todo).toEqual({
      key: "ai-draft:draft-action-1",
      text: "Review margin and cost assumptions",
      count: "high",
      tone: "danger",
      route: "project",
      targetId: "p-low-margin",
      draftId: "draft-action-1",
    });
  });

  it("blocks streamer callers from creating operations drafts", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    } as never);
    const { POST } = await import("./route");
    const response = await POST(post({ action: suggestedAction() }));

    expect(response.status).toBe(403);
    expect(createAiDraft).not.toHaveBeenCalled();
  });
});
