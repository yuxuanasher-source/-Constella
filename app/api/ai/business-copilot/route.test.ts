import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { POST } from "./route";

vi.mock("@/features/ai/ai-tool-layer", () => ({
  runAiToolQuery: vi.fn(),
}));

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-owner",
  email: "owner@example.test",
  name: "Owner",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "owner" as const,
};

const dashboard = {
  profile: {
    role: "owner",
    title: "经营总览看板",
    subtitle: "关注收入、毛利、履约和高风险动作",
    scopeLabel: "全组织",
  },
  kpis: [{ key: "grossMarginRate", label: "毛利率", value: 30, unit: "%" }],
  queue: [],
  risks: [],
  drilldowns: [],
  generatedAt: "2026-06-18T04:00:00.000Z",
};

describe("AI business copilot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadRoleHomeDashboard).mockResolvedValue(dashboard as never);
    vi.mocked(runAiToolQuery).mockResolvedValue({
      toolName: "business_copilot_answer",
      invocationId: "ai-invocation-1",
      mode: "deterministic",
      answer: "经营问答已生成。",
      output: {
        question: "这个月经营健康吗",
        intent: "executive_health",
        answer: "经营健康判断已基于当前角色看板生成。",
        facts: [{ label: "毛利率", value: 30, sourceId: "kpi:grossMarginRate" }],
        findings: [],
        recommendations: [],
        drilldowns: [],
        caveats: [],
        generatedAt: "2026-06-18T04:00:00.000Z",
      },
    } as never);
  });

  it("loads the authorized role dashboard and returns an audited copilot answer", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "这个月经营健康吗" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      result: {
        toolName: "business_copilot_answer",
        output: {
          intent: "executive_health",
          facts: expect.arrayContaining([
            expect.objectContaining({ sourceId: "kpi:grossMarginRate" }),
          ]),
        },
      },
      dashboardProfile: {
        role: "owner",
        scopeLabel: "全组织",
      },
    });
    expect(loadRoleHomeDashboard).toHaveBeenCalledWith({
      supabase: { client: "supabase" },
      auth,
    });
    expect(runAiToolQuery).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: {
        userId: "user-owner",
        name: "Owner",
        role: "owner",
        organizationId: "org-1",
      },
      toolName: "business_copilot_answer",
      input: {
        question: "这个月经营健康吗",
        dashboard,
      },
    });
  });

  it("rejects empty questions", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Business copilot question is required",
    });
    expect(loadRoleHomeDashboard).not.toHaveBeenCalled();
  });

  it("blocks streamers from internal business copilot", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "经营健康吗" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(loadRoleHomeDashboard).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "经营健康吗" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
