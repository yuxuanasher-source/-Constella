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

// 假 supabase：notifications.insert→{id}；ai_drafts.insert→{id}；audit_logs.insert→ok。
function makeClient(calls: { table: string; payload: unknown }[]) {
  return {
    from(table: string) {
      if (table === "notifications") {
        return {
          insert(payload: unknown) {
            calls.push({ table, payload });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: "notif-1" }, error: null }),
              }),
            };
          },
        };
      }
      if (table === "ai_drafts") {
        return {
          insert(payload: unknown) {
            calls.push({ table, payload });
            return {
              select: () =>
                Promise.resolve({ data: [{ id: "draft-1" }], error: null }),
            };
          },
        };
      }
      // audit_logs
      return {
        insert(payload: unknown) {
          calls.push({ table, payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe("POST /api/ai/bounded/transition", () => {
  let calls: { table: string; payload: unknown }[];

  beforeEach(() => {
    calls = [];
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      makeClient(calls) as never,
    );
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
  });

  function post(body: Record<string, unknown>) {
    return new Request("http://localhost/api/ai/bounded/transition", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("blocks non-staff callers", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" } as never);
    const { POST } = await import("./route");
    const res = await POST(post({ actionType: "notification", title: "x", content: "y", recipientRole: "owner" }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid input", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ actionType: "notification", title: "", content: "" }));
    expect(res.status).toBe(400);
  });

  it("executes a low-risk notification (queued → notifications insert + audit)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({
        actionType: "notification",
        notificationType: "system",
        recipientRole: "owner",
        title: "排班提醒",
        content: "今晚 20:00 开播",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("executed");
    expect(json.result.id).toBe("notif-1");
    expect(calls.some((c) => c.table === "notifications")).toBe(true);
    expect(calls.some((c) => c.table === "audit_logs")).toBe(true);
    // 不应落草稿。
    expect(calls.some((c) => c.table === "ai_drafts")).toBe(false);
  });

  it("routes a high-risk notification to pending confirmation (ai_drafts, no send)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({
        actionType: "notification",
        notificationType: "high_risk",
        recipientRole: "owner",
        isHighRisk: true,
        title: "高风险处置",
        content: "建议暂停该主播",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("pending_confirmation");
    expect(json.ref.id).toBe("draft-1");
    // 高风险通知不直接发：不写 notifications，落 ai_drafts。
    expect(calls.some((c) => c.table === "ai_drafts")).toBe(true);
    expect(calls.some((c) => c.table === "notifications")).toBe(false);
  });

  it("executes an exception ticket as a high-risk staff notification", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({
        actionType: "exception_ticket",
        taskId: "task-9",
        title: "未按时开播",
        content: "主播迟到 30 分钟",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("executed");
    expect(calls.some((c) => c.table === "notifications")).toBe(true);
  });
});
