import { describe, expect, it, vi } from "vitest";

import { DEFAULT_XINGYAO_RISK_WEIGHTS } from "./xingyao-risk-radar";
import {
  flattenXingyaoWeights,
  loadXingyaoRiskWeights,
  mergeXingyaoWeightRows,
  saveXingyaoRiskWeights,
  weightKeyFor,
  type XingyaoWeightRepositoryClient,
  type XingyaoWeightRow,
} from "./xingyao-weight-repository";

describe("flattenXingyaoWeights / mergeXingyaoWeightRows", () => {
  it("round-trips the default weights through flat rows", () => {
    const rows = flattenXingyaoWeights(DEFAULT_XINGYAO_RISK_WEIGHTS);
    expect(rows).toHaveLength(17);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          weight_key: "xingyao.account_ban.violation_density",
          weight_bps: 3_500,
        },
      ]),
    );
    expect(mergeXingyaoWeightRows(rows)).toEqual(DEFAULT_XINGYAO_RISK_WEIGHTS);
  });

  it("applies overrides while ignoring unknown models and signals", () => {
    const merged = mergeXingyaoWeightRows([
      {
        weight_key: weightKeyFor("account_ban", "violation_density"),
        weight_bps: 5_000,
      },
      { weight_key: "xingyao.account_ban.unknown_signal", weight_bps: 1 },
      { weight_key: "xingyao.unknown_model.violation_density", weight_bps: 2 },
      { weight_key: "other.prefix.key", weight_bps: 3 },
      {
        weight_key: weightKeyFor("streamer_retention", "inactivity"),
        weight_bps: 99_999,
      },
    ]);

    expect(merged.account_ban.violation_density).toBe(5_000);
    expect(merged.account_ban.traffic_collapse).toBe(
      DEFAULT_XINGYAO_RISK_WEIGHTS.account_ban.traffic_collapse,
    );
    expect(Object.keys(merged.account_ban)).not.toContain("unknown_signal");
    // 越界覆盖值被夹回数据库允许的 0-10000 区间。
    expect(merged.streamer_retention.inactivity).toBe(10_000);
  });
});

describe("loadXingyaoRiskWeights / saveXingyaoRiskWeights", () => {
  it("loads org overrides on top of the defaults", async () => {
    const rows: XingyaoWeightRow[] = [
      {
        weight_key: "xingyao.project_attainment.progress_gap",
        weight_bps: 4_200,
      },
    ];
    const client = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            like: async () => ({ data: rows, error: null }),
          }),
        }),
      })),
    } as unknown as XingyaoWeightRepositoryClient;

    const weights = await loadXingyaoRiskWeights(client, "org-1");
    expect(weights.project_attainment.progress_gap).toBe(4_200);
    expect(weights.account_ban).toEqual(
      DEFAULT_XINGYAO_RISK_WEIGHTS.account_ban,
    );
  });

  it("persists active rows keyed by organization and weight key", async () => {
    let saved: Record<string, unknown>[] = [];
    let conflict = "";
    const client = {
      from: vi.fn(() => ({
        upsert: async (
          payload: Record<string, unknown>[],
          options: { onConflict: string },
        ) => {
          saved = payload;
          conflict = options.onConflict;
          return { error: null };
        },
      })),
    } as unknown as XingyaoWeightRepositoryClient;

    const count = await saveXingyaoRiskWeights(client, {
      organizationId: "org-1",
      weights: DEFAULT_XINGYAO_RISK_WEIGHTS,
      updatedBy: "user-1",
    });

    expect(count).toBe(17);
    expect(conflict).toBe("organization_id,weight_key");
    expect(saved[0]).toMatchObject({
      organization_id: "org-1",
      status: "active",
      created_by: "user-1",
    });
  });

  it("throws when the load query fails", async () => {
    const client = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            like: async () => ({
              data: null,
              error: { message: "boom" },
            }),
          }),
        }),
      })),
    } as unknown as XingyaoWeightRepositoryClient;

    await expect(loadXingyaoRiskWeights(client, "org-1")).rejects.toThrow(
      "boom",
    );
  });
});
