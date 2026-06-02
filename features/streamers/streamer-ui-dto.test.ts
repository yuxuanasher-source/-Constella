import { describe, expect, it } from "vitest";

import { toStreamerCardDto } from "./streamer-ui-dto";

describe("toStreamerCardDto", () => {
  it("formats streamer rows for the reference UI without exposing settlement margin", () => {
    const dto = toStreamerCardDto({
      id: "s1",
      display_name: "小鹿",
      real_name: "鹿鸣",
      gender: "女",
      source_type: "signed",
      cooperation_status: "active",
      categories: ["二游", "赛事"],
      platforms: ["抖音"],
      styles: ["高能整活"],
      default_settlement_method: "cpt",
      risk_level: "medium",
      clean_report_count: 8,
      created_at: "2026-06-01T00:00:00.000Z",
    });

    expect(dto).toMatchObject({
      id: "s1",
      alias: "小鹿",
      real: "鹿鸣",
      gender: "女",
      source: "签约",
      supplier: "未绑定",
      games: ["二游", "赛事"],
      platforms: ["抖音"],
      style: "高能整活",
      cooperation: "active",
      risk: "medium",
      defaultRule: "CPT",
      createdAtLabel: "2026-06-01",
    });
    expect(dto).not.toHaveProperty("grossMargin");
    expect(dto).not.toHaveProperty("manufacturerReceivable");
  });
});
