import { describe, expect, it, vi } from "vitest";

import { loadCastingCandidates } from "./casting-candidate-loader";
import { toStreamerCardDto } from "./streamer-ui-dto";

const NOW = "2026-07-03T00:00:00.000Z";

type Call = [string, ...unknown[]];

function createClient(rows: unknown[], calls: Call[] = []) {
  return {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      const track =
        (name: string) =>
        (...args: unknown[]) => {
          calls.push([name, ...args]);
          return chain;
        };
      chain.select = track("select");
      chain.eq = track("eq");
      chain.in = track("in");
      chain.order = track("order");
      chain.limit = track("limit");
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve);
      return chain;
    }),
  } as never;
}

const baseRow = {
  id: "s1",
  display_name: "Ava",
  real_name: null,
  gender: null,
  source_type: "self_registered",
  cooperation_status: "active",
  categories: ["moba", "fps"],
  platforms: ["douyin"],
  styles: ["high-energy"],
  default_settlement_method: "cpt",
  default_price: 100,
  default_base_salary: null,
  default_cps_rate_bps: null,
  risk_level: "high",
  risk_tags: ["dispute_history"],
  clean_report_count: 3,
  created_at: "2026-06-01T00:00:00.000Z",
  recording_submissions: [
    { status: "approved", submitted_at: "2026-06-30T00:00:00.000Z" },
  ],
  streamer_profile_insights: [],
  live_tasks: [
    {
      status: "completed",
      planned_duration: 120,
      system_duration: 100,
      planned_start_at: "2026-06-28T00:00:00.000Z",
      project_id: "p1",
    },
    {
      // cancelled 任务不计入可排期容量。
      status: "cancelled",
      planned_duration: 60,
      system_duration: null,
      planned_start_at: "2026-06-27T00:00:00.000Z",
      project_id: "p1",
    },
  ],
  live_reports: [
    {
      status: "approved",
      settlement_duration: 120,
      evidence_level: "green",
      viewers: 4000,
      created_at: "2026-06-29T00:00:00.000Z",
      project_id: "p1",
      projects: { default_hourly_rate: 100 },
    },
  ],
  project_streamers: [
    {
      status: "active",
      project_id: "p1",
      projects: {
        id: "p1",
        code: "P1",
        name: "Campaign Alpha",
        status: "completed",
        default_hourly_rate: 100,
      },
    },
  ],
};

describe("loadCastingCandidates", () => {
  it("maps pool rows to candidate snapshots with the streamer-card metric units", async () => {
    const calls: Call[] = [];
    const client = createClient([baseRow], calls);

    const { candidates, dataGaps } = await loadCastingCandidates(client, {
      organizationId: "org-1",
      requiredMinutes: 900,
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];

    // 指标换算必须与主播池卡片同口径:百分比 ×100 = bps,元 ×100 = 分。
    const card = toStreamerCardDto(baseRow as never, { now: NOW });
    expect(candidate.completionRateBps).toBe(
      Math.round(card.metrics.projectFinish * 100),
    );
    expect(candidate.screeningPassRateBps).toBe(
      Math.round(card.metrics.screenPass * 100),
    );
    expect(candidate.roiBps).toBe(Math.round(card.metrics.roi * 10000));
    expect(candidate.grossMarginContributionCents).toBe(
      Math.round(card.metrics.grossContrib * 100),
    );

    expect(candidate).toMatchObject({
      id: "s1",
      name: "Ava",
      categories: ["moba", "fps"],
      platforms: ["douyin"],
      styles: ["high-energy"],
      // 真实 risk_tags 列 + 高风险等级追加标签。
      riskTags: ["dispute_history", "high_risk"],
      // 近三十天非取消任务时长(system_duration 优先)。
      availableMinutes: 100,
      referenceProjects: [
        { id: "p1", name: "Campaign Alpha", result: "completed" },
      ],
    });

    expect(dataGaps).toContain("candidate_roi_proxy");
    expect(dataGaps).not.toContain("candidate_availability");

    // 组织隔离 + 防线上限。
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", "org-1"],
        ["limit", 200],
      ]),
    );
  });

  it("defaults availability to requiredMinutes and declares the gap when no recent tasks exist", async () => {
    const row = { ...baseRow, live_tasks: [] };
    const client = createClient([row]);

    const { candidates, dataGaps } = await loadCastingCandidates(client, {
      organizationId: "org-1",
      requiredMinutes: 900,
      now: NOW,
    });

    expect(candidates[0].availableMinutes).toBe(900);
    expect(dataGaps).toContain("candidate_availability");
  });

  it("filters by candidateIds when provided", async () => {
    const calls: Call[] = [];
    const client = createClient([baseRow], calls);

    await loadCastingCandidates(client, {
      organizationId: "org-1",
      requiredMinutes: 900,
      candidateIds: ["s1", "s2"],
      now: NOW,
    });

    expect(calls).toEqual(
      expect.arrayContaining([["in", "id", ["s1", "s2"]]]),
    );
  });
});
