import { describe, expect, it } from "vitest";

import { dataGapCaveats } from "./data-gaps";

describe("dataGapCaveats", () => {
  it("does not retain the retired candidate ROI proxy semantics", () => {
    expect(dataGapCaveats(["candidate_roi_proxy"])).toEqual([
      {
        summary: "部分数据暂无真实来源,已按缺失口径处理",
        unverifiedExternalFactor: true,
      },
    ]);
  });

  it("explains missing real candidate ROI evidence explicitly", () => {
    expect(dataGapCaveats(["candidate_roi"])).toEqual([
      {
        summary: "候选主播缺少归因 GMV 或有效实际结算,投产比按缺失处理",
        unverifiedExternalFactor: true,
      },
    ]);
  });

  it("explains incomplete streamer ROI evidence without calling it sourceless", () => {
    expect(dataGapCaveats(["streamer_roi"])).toEqual([
      {
        summary: "主播缺少归因 GMV 或有效实际结算,投产比按缺失处理",
        unverifiedExternalFactor: true,
      },
    ]);
  });
});
