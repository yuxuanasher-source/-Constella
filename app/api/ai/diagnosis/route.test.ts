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

// 支持 gatherStreamerDiagnosisContext 的链式查询,同时保留账本 insert。
function createGroundedClient(tables: Record<string, unknown[]>) {
  return {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {
        insert: vi.fn(async () => ({ error: null })),
      };
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = async () => ({ data: rows, error: null });
      return chain;
    }),
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

  it("prefers server-grounded report data over caller-supplied numbers", async () => {
    // 服务端能查到主播的真实报数时,客户端 POST 的 report 必须被覆盖
    // (信任根收敛:客户端数据只是无绑定演示场景的兜底)。
    const client = createGroundedClient({
      streamers: [{ id: "streamer-1" }],
      live_reports: [
        {
          viewers: 2488,
          settlement_duration: 180,
          evidence_level: "green",
          risk_flags: ["duration_divergence"],
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

    const response = await POST(
      new Request("http://localhost/api/ai/diagnosis", {
        method: "POST",
        body: JSON.stringify({
          report: { totalViews: 300, settlementDuration: 30 },
          feedback: ["编造的反馈"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const statements = body.agentOutput.facts.map(
      (fact: { statement: string }) => fact.statement,
    );
    expect(statements).toContain("本场总观看数为 2488");
    expect(statements).not.toContain("本场总观看数为 300");
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
