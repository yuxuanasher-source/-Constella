import { describe, expect, it } from "vitest";

import { toVendorDeliveryPackageItem } from "./delivery-package-dto";

describe("vendor delivery package dto", () => {
  it("does not expose internal finance or risk fields", () => {
    const dto = toVendorDeliveryPackageItem({
      project_id: "project-1",
      project_name: "王者荣耀暑期冲榜",
      streamer_name: "阿洛",
      settlement_duration_minutes: 120,
      evidence_level: "system",
      screenshot_count: 2,
      cost_cents: 10000,
      gross_margin_cents: 3000,
      vendor_receivable_cents: 13000,
      internal_risk_note: "历史争议",
    });

    expect(dto).toEqual({
      projectId: "project-1",
      projectName: "王者荣耀暑期冲榜",
      streamerName: "阿洛",
      settlementDurationMinutes: 120,
      evidenceLevel: "system",
      screenshotCount: 2,
    });
    expect(JSON.stringify(dto)).not.toContain("cost");
    expect(JSON.stringify(dto)).not.toContain("gross");
    expect(JSON.stringify(dto)).not.toContain("vendor_receivable");
    expect(JSON.stringify(dto)).not.toContain("internal_risk_note");
  });
});
