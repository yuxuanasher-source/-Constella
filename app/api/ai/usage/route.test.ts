import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

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

const invocationRows = [
  {
    id: "inv-1",
    scene: "business_analysis",
    provider_name: "hunyuan",
    status: "succeeded",
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cost_cents: 2,
    latency_ms: 320,
    actor_name: "Ops Manager",
    created_at: new Date().toISOString(),
  },
];

function mockSupabase(rows: typeof invocationRows, error: Error | null = null) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.returns = vi.fn(async () => ({ data: rows, error }));
  return { from: vi.fn(() => builder) };
}

describe("AI usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns the aggregated usage overview for MCN staff", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      mockSupabase(invocationRows) as never,
    );

    const response = await GET(
      new Request("http://localhost/api/ai/usage?rangeDays=14"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.usage.rangeDays).toBe(14);
    expect(body.usage.totals.invocations).toBe(1);
    expect(body.usage.totals.costCents).toBe(2);
    expect(body.usage.byScene[0].scene).toBe("business_analysis");
    expect(body.usage.dailyTrend).toHaveLength(14);
  });

  it("blocks streamers", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      mockSupabase(invocationRows) as never,
    );
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await GET(new Request("http://localhost/api/ai/usage"));
    expect(response.status).toBe(403);
  });

  it("requires authentication", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      mockSupabase(invocationRows) as never,
    );
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/ai/usage"));
    expect(response.status).toBe(401);
  });
});
