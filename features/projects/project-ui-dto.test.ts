import { describe, expect, it } from "vitest";

import { toProjectCardDto } from "./project-ui-dto";

describe("toProjectCardDto", () => {
  it("formats project list rows for the reference UI without exposing unsafe money math", () => {
    const dto =
      toProjectCardDto({
        id: "p1",
        code: "P2412",
        name: "鸣潮暑期招募",
        status: "recruiting",
        sensitivity: "normal",
        force_system_timing: true,
        default_hourly_rate: 4500,
        published_at: "2026-06-01T10:00:00.000Z",
        created_at: "2026-06-01T09:00:00.000Z",
      });

    expect(dto).toMatchObject({
      id: "p1",
      code: "P2412",
      name: "鸣潮暑期招募",
      vendor: "未填写",
      product: "鸣潮暑期招募",
      status: "recruiting",
      statusLabel: "招募中",
      hourlyRateLabel: "45.00 元/小时",
      timingLabel: "系统计时",
      publishedAtLabel: "2026-06-01",
      pricing: "CPT",
      leadOps: "未分配",
      streamers: { active: 0, candidate: 0, pendingReview: 0 },
      metrics: {
        plannedHours: 0,
        doneHours: 0,
        audience: 0,
        reportedPending: 0,
        anomalies: 0,
        receivable: 0,
        payable: 0,
        gross: 0,
        margin: 0,
      },
      risk: "low",
    });
    expect(dto).not.toHaveProperty("manufacturerReceivable");
  });
});
