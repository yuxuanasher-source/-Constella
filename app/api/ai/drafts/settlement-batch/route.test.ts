import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAiDraft } from "@/features/ai/draft-repository";
import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
}));
vi.mock("@/features/ai/draft-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/ai/draft-repository")
  >("@/features/ai/draft-repository");
  return { ...actual, createAiDraft: vi.fn() };
});
vi.mock("@/lib/audit/audit", () => ({ writeAuditLog: vi.fn() }));

const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

function poolItem(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    projectId: "p1",
    projectName: "项目甲",
    streamerName: "主播一",
    settlementDuration: 120,
    timeSource: "system",
    evidenceLevel: "green",
    settlementMethod: "cpt",
    cpsRateBps: 0,
    expectedAmount: 10000,
    approvedAt: "2026-06-02T00:00:00Z",
    ...over,
  };
}

describe("POST /api/ai/drafts/settlement-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
    vi.mocked(createAiDraft).mockResolvedValue({ id: "draft-1" });
    vi.mocked(writeAuditLog).mockResolvedValue(undefined as never);
  });

  function post(body: Record<string, unknown>) {
    return new Request("http://localhost/api/ai/drafts/settlement-batch", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("blocks non-staff (streamer) callers", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" } as never);
    const { POST } = await import("./route");
    const res = await POST(post({ periodStart: "2026-06-01", periodEnd: "2026-06-30" }));
    expect(res.status).toBe(403);
  });

  it("requires a period window", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("builds a pending settlement-batch draft from the pool and persists it", async () => {
    vi.mocked(listOpsSettlementPool).mockResolvedValue([
      poolItem({ id: "r1", evidenceLevel: "green", timeSource: "system", expectedAmount: 10000 }),
      poolItem({ id: "r2", evidenceLevel: "green", timeSource: "system", expectedAmount: 8000 }),
      poolItem({ id: "r3", evidenceLevel: "yellow", timeSource: "system", expectedAmount: 5000 }),
    ] as never);

    const { POST } = await import("./route");
    const res = await POST(post({ periodStart: "2026-06-01", periodEnd: "2026-06-30", batchType: "payable" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.draft.id).toBe("draft-1");
    expect(json.draft.status).toBe("pending");
    expect(json.draft.draftType).toBe("settlement_batch");
    expect(json.draft.payload.totals.cptEligibleCount).toBe(2);
    expect(json.draft.payload.totals.weakEvidenceCount).toBe(1);

    // 落库为 pending 草稿，并写审计。
    const createArg = vi.mocked(createAiDraft).mock.calls[0][1];
    expect(createArg.envelope.status).toBe("pending");
    expect(createArg.organizationId).toBe("org-1");
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledTimes(1);
  });
});
