import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

function createClient() {
  const inserts: Record<string, Record<string, unknown>[]> = {};
  return {
    client: {
      from: vi.fn((table: string) => ({
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          inserts[table] = [...(inserts[table] ?? []), payload];
          return { error: null };
        }),
      })),
    },
    inserts,
  };
}

describe("AI scripts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a draft script version for MCN staff", async () => {
    const { client, inserts } = createClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);

    const response = await POST(
      new Request("http://localhost/api/ai/scripts", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      scriptVersionDraft: {
        scriptKey: "opening-hook",
        version: 1,
        status: "draft",
        content: expect.stringContaining("Opening hook"),
      },
      validation: { valid: true, errors: [] },
    });
    expect(body.agentOutput.facts.length).toBeGreaterThan(0);
    expect(inserts.ai_script_versions).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        script_key: "opening-hook",
        version: 1,
        status: "draft",
        content: expect.stringContaining("Opening hook"),
        created_by: "user-ops",
      }),
    ]);
    expect(JSON.stringify(inserts.ai_script_versions)).not.toContain("published");
  });

  it("blocks streamers from creating script version drafts", async () => {
    const { client } = createClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/scripts", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("requires authentication", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/scripts", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(401);
  });
});

function createRequestBody() {
  return {
    scriptKey: "opening-hook",
    version: 1,
    currentScript: "Welcome to the stream.",
    diagnosisType: "traffic_drop",
    feedback: ["weak opening"],
    replayNotes: ["viewers left during intro"],
    streamerId: "streamer-a",
    projectId: "project-a",
  };
}
