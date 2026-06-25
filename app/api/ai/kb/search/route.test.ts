import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

// 假 supabase：knowledge_documents 链式 select → 返回给定行。
function makeClient(rows: Record<string, unknown>[]) {
  const builder: Record<string, unknown> = {};
  builder.eq = () => builder;
  builder.in = () => builder;
  builder.order = () => builder;
  builder.limit = () => Promise.resolve({ data: rows, error: null });
  return {
    from: () => ({ select: () => builder }),
  };
}

describe("POST /api/ai/kb/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
  });

  function post(body: Record<string, unknown>) {
    return new Request("http://localhost/api/ai/kb/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("blocks non-staff callers", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(makeClient([]) as never);
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" } as never);
    const { POST } = await import("./route");
    const res = await POST(post({ query: "结算口径" }));
    expect(res.status).toBe(403);
  });

  it("requires a query", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(makeClient([]) as never);
    const { POST } = await import("./route");
    const res = await POST(post({ query: "  " }));
    expect(res.status).toBe(400);
  });

  it("answers 无数据 when no passages match", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(makeClient([]) as never);
    const { POST } = await import("./route");
    const res = await POST(post({ query: "不存在的主题" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasData).toBe(false);
    expect(json.answer).toContain("无数据");
    expect(json.citations).toEqual([]);
  });

  it("returns cited passages with the number disclaimer", async () => {
    const rows = [
      {
        id: "kb-1",
        doc_type: "policy",
        title: "结算口径说明",
        body: "结算以系统计时为准，绿灯证据方可计入 CPT 结算口径。",
        source_ref: "doc:settlement-policy#1",
        tags: ["结算"],
      },
    ];
    vi.mocked(createSupabaseServerClient).mockResolvedValue(makeClient(rows) as never);
    const { POST } = await import("./route");
    const res = await POST(post({ query: "结算口径" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasData).toBe(true);
    expect(json.citations.length).toBeGreaterThan(0);
    expect(json.citations[0].sourceRef).toBe("doc:settlement-policy#1");
    expect(json.answer).toContain("结构化数据查询为准");
  });
});
