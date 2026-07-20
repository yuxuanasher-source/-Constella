import { describe, expect, it } from "vitest";

import {
  defaultRecordingProductionGuide,
  normalizeRecordingGuideRow,
} from "./recording-production-guide";

describe("recording production guide", () => {
  it("normalizes project guide rows for streamer task cards", () => {
    expect(
      normalizeRecordingGuideRow({
        game_name: "星海测试服",
        game_version: "1.2",
        server_region: "安卓一区",
        promotion_goal: "新版本拉新",
        target_audience: "新手玩家",
        required_content: ["新职业", "活动入口"],
        required_talking_points: ["福利领取方式"],
        forbidden_content: ["虚假保底", "攻击竞品"],
        commercial_actions: ["展示预约福利入口"],
        technical_standard: { minDurationMinutes: 10, orientation: "landscape" },
        template_text: "开场说明今天测试新职业。",
        example_url: "https://example.com/demo",
      }),
    ).toMatchObject({
      gameName: "星海测试服",
      gameVersion: "1.2",
      serverRegion: "安卓一区",
      promotionGoal: "新版本拉新",
      targetAudience: "新手玩家",
      requiredContent: ["新职业", "活动入口"],
      requiredTalkingPoints: ["福利领取方式"],
      forbiddenContent: ["虚假保底", "攻击竞品"],
      commercialActions: ["展示预约福利入口"],
      templateText: "开场说明今天测试新职业。",
      exampleUrl: "https://example.com/demo",
    });
  });

  it("builds a useful fallback from the public project card", () => {
    expect(
      defaultRecordingProductionGuide({
        product: "星海",
        publicSummary: "重点展示新职业和福利入口。",
        forceRecording: true,
      }),
    ).toMatchObject({
      gameName: "星海",
      requiredContent: ["重点展示新职业和福利入口。"],
      templateText: expect.stringContaining("开场"),
    });
  });
});
