import { describe, expect, it } from "vitest";

import { buildLiveReviewTemplate } from "./live-review-template";
import { parseLiveReview } from "./live-review-knowledge";

describe("buildLiveReviewTemplate", () => {
  it("renders the full review skeleton with all five sections", () => {
    const md = buildLiveReviewTemplate();
    expect(md).toContain("### 一、基础信息");
    expect(md).toContain("### 二、核心数据（目标 vs 实际）");
    expect(md).toContain("### 三、做对了什么（可复制）");
    expect(md).toContain("### 四、问题与归因（这一段是复盘的核心）");
    expect(md).toContain("### 五、行动项（下场必须改的）");
    expect(md).toContain("流失最大的那一环");
  });

  it("prefills the 基础信息 table from task context", () => {
    const md = buildLiveReviewTemplate({
      reviewDate: "2026-06-24",
      sessionLabel: "新项目草稿",
      product: "王者荣耀",
      server: "国服",
      streamer: "大帅逼",
      platform: "抖音",
      liveWindow: "09:00 – 23:30（14.5h）",
      goal: "冲付费",
    });

    const parsed = parseLiveReview(md);
    expect(parsed.product).toContain("王者荣耀");
    expect(parsed.platform).toBe("抖音");
    expect(parsed.goal).toBe("冲付费");
    expect(md).toContain("2026-06-24 / 新项目草稿");
    expect(md).toContain("大帅逼");
  });
});
