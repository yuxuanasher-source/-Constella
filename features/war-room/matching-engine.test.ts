import { describe, expect, it } from "vitest";

import {
  rankStreamerCandidates,
  scoreSupplierQuality,
} from "./matching-engine";

const project = {
  category: "moba",
  platform: "douyin",
  preferredStyles: ["高互动", "教学"],
  requiredMinutes: 900,
};

describe("rankStreamerCandidates", () => {
  it("returns score, reasons, risk notes, references, and settlement suggestion", () => {
    const [best, risky] = rankStreamerCandidates({
      project,
      candidates: [
        {
          id: "streamer-a",
          name: "Ava",
          categories: ["moba", "fps"],
          platforms: ["douyin"],
          styles: ["高互动", "剧情"],
          completionRateBps: 9200,
          screeningPassRateBps: 8800,
          roiBps: 14000,
          grossMarginContributionCents: 180000,
          riskTags: [],
          availableMinutes: 1200,
          referenceProjects: [
            { id: "project-a", name: "王者荣耀春节档", result: "完成率 95%" },
          ],
        },
        {
          id: "streamer-b",
          name: "Bo",
          categories: ["slg"],
          platforms: ["kuaishou"],
          styles: ["整活"],
          completionRateBps: 5600,
          screeningPassRateBps: 4300,
          roiBps: 3000,
          grossMarginContributionCents: -20000,
          riskTags: ["recent_anomaly", "dispute"],
          availableMinutes: 300,
          referenceProjects: [],
        },
      ],
    });

    expect(best).toMatchObject({
      streamerId: "streamer-a",
      score: 93,
      suggestedSettlementMethod: "base_salary_cpt",
      reasons: expect.arrayContaining([
        "category_match",
        "platform_match",
        "style_match",
        "high_completion_rate",
        "positive_margin_contribution",
      ]),
      riskNotes: [],
      referenceProjects: [
        { id: "project-a", name: "王者荣耀春节档", result: "完成率 95%" },
      ],
    });
    expect(risky).toMatchObject({
      streamerId: "streamer-b",
      score: 4,
      suggestedSettlementMethod: "base_salary",
      riskNotes: expect.arrayContaining([
        "recent_anomaly",
        "dispute",
        "availability_shortage",
      ]),
    });
  });
});

describe("scoreSupplierQuality", () => {
  it("scores supplier quality from pass rate, completion, margin, anomalies, and blacklist penalties", () => {
    expect(
      scoreSupplierQuality({
        id: "supplier-a",
        name: "星河公会",
        screeningPassRateBps: 9000,
        completionRateBps: 8500,
        marginContributionCents: 1500000,
        anomalyRateBps: 500,
        blacklistRateBps: 0,
        isBlacklisted: false,
      }),
    ).toMatchObject({
      supplierId: "supplier-a",
      score: 89,
      grade: "A",
      reasons: expect.arrayContaining([
        "high_screening_pass_rate",
        "high_completion_rate",
        "positive_margin_contribution",
      ]),
      riskNotes: [],
    });
  });

  it("keeps blacklisted suppliers at the bottom with explicit risk notes", () => {
    expect(
      scoreSupplierQuality({
        id: "supplier-b",
        name: "低质资源包",
        screeningPassRateBps: 4000,
        completionRateBps: 5000,
        marginContributionCents: -50000,
        anomalyRateBps: 2500,
        blacklistRateBps: 2000,
        isBlacklisted: true,
      }),
    ).toMatchObject({
      supplierId: "supplier-b",
      score: 0,
      grade: "D",
      riskNotes: expect.arrayContaining([
        "negative_margin_contribution",
        "high_anomaly_rate",
        "blacklist_penalty",
        "supplier_blacklisted",
      ]),
    });
  });
});
