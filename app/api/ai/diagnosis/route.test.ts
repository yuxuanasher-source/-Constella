import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

const auth = {
  userId: "user-streamer",
  email: "streamer@jy-demo.local",
  name: "主播 Ava",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "streamer" as const,
};

function createClient() {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
    })),
  };
}

describe("AI diagnosis route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createClient() as never,
    );
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns streamer-safe diagnosis placeholder", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/diagnosis", {
        method: "POST",
        body: JSON.stringify({
          task: { title: "晚高峰冲榜", game: "moba" },
          report: {
            totalViews: 300,
            grossMarginCents: 50000,
          },
          feedback: ["互动断层"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.output.scriptSuggestions.length).toBeGreaterThan(0);
    expect(body.agentOutput.facts.length).toBeGreaterThan(0);
    expect(body.validation).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(body)).not.toContain("grossMarginCents");
  });

  it("records telemetry through the service client so streamer RLS does not block it", async () => {
    const userClient = createClient();
    const adminClient = createClient();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      userClient as never,
    );
    vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as never);

    const response = await POST(
      new Request("http://localhost/api/ai/diagnosis", {
        method: "POST",
        body: JSON.stringify({ feedback: ["互动断层"] }),
      }),
    );

    expect(response.status).toBe(200);
    // The append-only AI ledger writes must go through the admin client,
    // not the streamer's RLS-scoped session.
    expect(adminClient.from).toHaveBeenCalledWith("ai_invocations");
    expect(userClient.from).not.toHaveBeenCalledWith("ai_invocations");
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/diagnosis", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });
});
