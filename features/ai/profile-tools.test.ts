import { describe, expect, it } from "vitest";

import {
  matchBlacklist,
  summarizeStreamerProfile,
} from "./profile-tools";

describe("matchBlacklist (L1)", () => {
  it("blocks an explicitly blacklisted streamer", () => {
    const m = matchBlacklist({ riskLevel: "blacklisted", blacklistReason: "刷量封号" });
    expect(m.hit).toBe(true);
    expect(m.severity).toBe("block");
    expect(m.matchedOn).toContain("risk_level:blacklisted");
    expect(m.recommendation).toContain("拦截");
  });

  it("routes high risk-level / risky tags to human review", () => {
    expect(matchBlacklist({ riskLevel: "high" }).severity).toBe("review");
    const tagged = matchBlacklist({ riskLevel: "low", riskTags: ["duration_fraud"] });
    expect(tagged.severity).toBe("review");
    expect(tagged.matchedOn).toContain("risk_tag:duration_fraud");
  });

  it("matches Chinese risk-tag keywords", () => {
    const m = matchBlacklist({ riskTags: ["历史刷单"] });
    expect(m.severity).toBe("review");
    expect(m.hit).toBe(true);
  });

  it("clears a low-risk streamer", () => {
    const m = matchBlacklist({ riskLevel: "low", riskTags: ["二游", "卡牌"] });
    expect(m.hit).toBe(false);
    expect(m.severity).toBe("clear");
  });
});

describe("summarizeStreamerProfile (L1) masking", () => {
  const profile = {
    display_name: "主播阿木",
    categories: ["二游", "卡牌"],
    platforms: ["抖音"],
    styles: ["治愈"],
    skills: ["唱歌"],
    risk_level: "medium",
    risk_tags: ["needs_watch"],
    clean_report_count: 12,
    duration_baseline: 120,
    cooperation_status: "active",
    risk_reason: "内部：曾两次偏差超阈值",
    blacklist_reason: null,
    operation_note: "内部：优先安排晚场",
  };

  it("hides internal risk/operation notes from streamer-facing callers", () => {
    const summary = summarizeStreamerProfile(profile, "streamer");
    expect(summary.internal).toBe(false);
    expect(summary.displayName).toBe("主播阿木");
    expect(summary.categories).toEqual(["二游", "卡牌"]);
    expect("riskReason" in summary).toBe(false);
    expect("operationNote" in summary).toBe(false);
  });

  it("exposes internal fields to MCN staff", () => {
    const summary = summarizeStreamerProfile(profile, "ops_manager");
    expect(summary.internal).toBe(true);
    expect(summary.riskReason).toContain("偏差超阈值");
    expect(summary.operationNote).toContain("晚场");
  });

  it("accepts camelCase records too", () => {
    const summary = summarizeStreamerProfile(
      { displayName: "主播B", riskLevel: "low", cleanReportCount: 3 },
      "owner",
    );
    expect(summary.displayName).toBe("主播B");
    expect(summary.cleanReportCount).toBe(3);
  });
});
