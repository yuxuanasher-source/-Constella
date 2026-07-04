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

const staff = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

function validBody() {
  return {
    authenticity: {
      modelName: "hunyuan-pro",
      requestId: "req-1",
      traceId: "trace-1",
      promptInput: "复盘项目",
      responseOutput: { 结论: "ok" },
      usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
      latencyMs: 900,
      timestamp: "2026-06-26T09:00:00.000Z",
    },
    output: {
      结论: "项目利润达标",
      建议: "维持配置",
      可执行动作: [{ 动作: "schedule_project_review", 需人工审批: true }],
    },
    objectType: "project",
    objectId: "proj-1",
    processNode: "复盘",
    invocationId: "00000000-0000-4000-8000-000000000001",
    costCents: 5,
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/ai/audit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("AI audit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(staff);
  });

  it("returns a production-grade verdict for MCN staff", async () => {
    const response = await POST(request(validBody()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verdict.最终判定).toBe("通过");
    expect(body.verdict.业务对象映射).toEqual(["project"]);
    expect(body.verdict.流程节点).toBe("复盘");
  });

  it("flags an unqualified output as 不通过", async () => {
    const response = await POST(
      request({ ...validBody(), processNode: undefined }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verdict.最终判定).toBe("不通过");
    expect(body.verdict.缺失字段).toContain("process_node");
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(request(validBody()));
    expect(response.status).toBe(401);
  });

  it("forbids non-staff roles", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...staff,
      role: "streamer",
    });

    const response = await POST(request(validBody()));
    expect(response.status).toBe(403);
  });
});
