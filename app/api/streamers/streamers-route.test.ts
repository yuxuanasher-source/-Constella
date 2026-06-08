import { beforeEach, describe, expect, it, vi } from "vitest";

import { listStreamerPool } from "@/features/streamers/streamer-queries";
import {
  createStreamerProfile,
  updateStreamerRisk,
  updateStreamerSettlementRule,
} from "@/features/streamers/streamer-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/streamers/streamer-queries", () => ({
  listStreamerPool: vi.fn(),
}));

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/streamers/streamer-service")
  >("@/features/streamers/streamer-service");
  return {
    ...actual,
    createStreamerProfile: vi.fn(),
    updateStreamerRisk: vi.fn(),
    updateStreamerSettlementRule: vi.fn(),
  };
});

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const supabase = { client: "supabase" };
const auth = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

function jsonRequest(body: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/api/streamers", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("streamer api routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
  });

  it("GET /api/streamers returns streamer DTOs", async () => {
    vi.mocked(listStreamerPool).mockResolvedValue([
      {
        id: "s1",
        display_name: "小鹿",
        real_name: "鹿鸣",
        gender: "女",
        source_type: "signed",
        cooperation_status: "active",
        categories: ["二游"],
        platforms: ["抖音"],
        styles: ["高能整活"],
        default_settlement_method: "cpt",
        risk_level: "low",
        clean_report_count: 5,
        created_at: "2026-06-01T00:00:00.000Z",
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      streamers: [
        expect.objectContaining({
          id: "s1",
          alias: "小鹿",
          defaultRule: "CPT",
        }),
      ],
    });
  });

  it("POST /api/streamers creates a streamer profile through the audited service", async () => {
    vi.mocked(createStreamerProfile).mockResolvedValue({
      id: "s1",
      displayName: "小鹿",
      riskLevel: "low",
      cooperationStatus: "not_started",
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest({
        displayName: " 小鹿 ",
        realName: " 鹿鸣 ",
        gender: "女",
        sourceType: "signed",
        categories: ["二游", "卡牌", ""],
        platforms: "抖音, 小红书",
        styles: "高能整活,陪伴",
        defaultSettlementMethod: "cps",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 1500,
        userId: " streamer-user ",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      streamer: expect.objectContaining({ id: "s1", displayName: "小鹿" }),
    });
    expect(createStreamerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.any(Function),
        actor: auth,
        input: {
          displayName: "小鹿",
          realName: "鹿鸣",
          gender: "女",
          sourceType: "signed",
          categories: ["二游", "卡牌"],
          platforms: ["抖音", "小红书"],
          styles: ["高能整活", "陪伴"],
          defaultSettlementMethod: "cps",
          defaultHourlyRate: 80,
          defaultBaseSalary: 6000,
          defaultCpsRateBps: 1500,
          userId: "streamer-user",
        },
      }),
    );
  });

  it("POST /api/streamers rejects invalid settlement numbers", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest({
        displayName: "Bad Streamer",
        defaultHourlyRate: -1,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "defaultHourlyRate must be non-negative",
    });
    expect(createStreamerProfile).not.toHaveBeenCalled();
  });

  it("surfaces Supabase query errors instead of hiding them as unexpected", async () => {
    vi.mocked(listStreamerPool).mockRejectedValue({
      code: "42703",
      message: "column streamers.default_cps_rate_bps does not exist",
    });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "column streamers.default_cps_rate_bps does not exist",
    });
  });

  it("PATCH /api/streamers/[streamerId]/risk requires reason and calls risk service", async () => {
    vi.mocked(updateStreamerRisk).mockResolvedValue({
      id: "s1",
      displayName: "小鹿",
      riskLevel: "high",
      cooperationStatus: "active",
    } as never);

    const { PATCH } = await import("./[streamerId]/risk/route");
    const response = await PATCH(
      jsonRequest(
        {
          riskLevel: "high",
          riskReason: "连续报数异常",
          reason: "负责人复核调整",
        },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "s1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      streamer: expect.objectContaining({ id: "s1", riskLevel: "high" }),
    });
    expect(updateStreamerRisk).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.any(Function),
        actor: auth,
        streamerId: "s1",
        reason: "负责人复核调整",
        input: {
          riskLevel: "high",
          riskReason: "连续报数异常",
          blacklistReason: undefined,
        },
      }),
    );
  });

  it("PATCH /api/streamers/[streamerId]/settlement-rule updates high-risk settlement defaults", async () => {
    vi.mocked(updateStreamerSettlementRule).mockResolvedValue({
      id: "s1",
      displayName: "Price Streamer",
      riskLevel: "low",
      cooperationStatus: "active",
    } as never);

    const { PATCH } = await import("./[streamerId]/settlement-rule/route");
    const response = await PATCH(
      jsonRequest(
        {
          defaultSettlementMethod: "cps",
          defaultHourlyRate: 0,
          defaultBaseSalary: 0,
          defaultCpsRateBps: 1500,
          reason: "signed cps update",
        },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "s1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateStreamerSettlementRule).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.any(Function),
        actor: auth,
        streamerId: "s1",
        reason: "signed cps update",
        input: {
          defaultSettlementMethod: "cps",
          defaultHourlyRate: 0,
          defaultBaseSalary: 0,
          defaultCpsRateBps: 1500,
        },
      }),
    );
  });
});
