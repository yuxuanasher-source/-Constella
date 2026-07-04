import { describe, expect, it, vi } from "vitest";

import {
  detectRecordingRisks,
  dispatchRecordingRiskAlerts,
  riskAlertNotificationSource,
  type RecordingRiskAlert,
} from "./recording-risk-detection";

describe("detectRecordingRisks", () => {
  it("detects sensitive words with severity from the lexicon", () => {
    const alerts = detectRecordingRisks({
      transcript: [
        { atSeconds: 120, text: "想赢的兄弟去外围看看" },
        { atSeconds: 300, text: "需要脚本代练的私聊" },
        { atSeconds: 400, text: "正常游戏讲解" },
      ],
    });

    expect(alerts).toEqual([
      expect.objectContaining({
        category: "sensitive_word",
        severity: "high",
        term: "外围",
        atSeconds: 120,
      }),
      expect.objectContaining({
        category: "sensitive_word",
        severity: "medium",
        term: "脚本代练",
        atSeconds: 300,
      }),
    ]);
    expect(alerts[0].evidence).toMatchObject({ matchedTerm: "外围" });
  });

  it("flags platform-banned content as high severity", () => {
    const alerts = detectRecordingRisks({
      transcript: [{ atSeconds: 60, text: "下单还有返现拿" }],
    });

    expect(alerts).toEqual([
      expect.objectContaining({
        category: "banned_content",
        severity: "high",
        term: "返现",
      }),
    ]);
  });

  it("maps operation events to violation alerts and sorts by time", () => {
    const alerts = detectRecordingRisks({
      transcript: [{ atSeconds: 500, text: "这里有赌博成分" }],
      operationEvents: [
        { atSeconds: 30, kind: "off_platform_redirect", detail: "展示二维码" },
        { atSeconds: 900, kind: "afk_streaming" },
        { atSeconds: 1000, kind: "unknown_event" },
      ],
    });

    expect(alerts.map((alert) => alert.atSeconds)).toEqual([30, 500, 900]);
    expect(alerts[0]).toMatchObject({
      category: "violation_operation",
      severity: "high",
      term: "off_platform_redirect",
    });
    expect(alerts[2]).toMatchObject({
      category: "violation_operation",
      severity: "medium",
      term: "afk_streaming",
    });
  });

  it("returns no alerts for clean input", () => {
    expect(
      detectRecordingRisks({
        transcript: [{ atSeconds: 0, text: "大家好，今天继续上分" }],
        operationEvents: [],
      }),
    ).toEqual([]);
  });
});

function highAlert(
  overrides: Partial<RecordingRiskAlert> = {},
): RecordingRiskAlert {
  return {
    category: "sensitive_word",
    severity: "high",
    term: "赌博",
    atSeconds: 120,
    message: "话术命中敏感词「赌博」，请复核该时间点上下文。",
    evidence: {},
    ...overrides,
  };
}

function createDispatchClient(existingSources: string[] = []) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: vi.fn((table: string) => {
      if (table !== "notifications") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          inserts.push(payload);
          return { error: null };
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_column: string, source: string) => ({
              limit: vi.fn(async () => ({
                data: existingSources.includes(source)
                  ? [{ id: "notification-1" }]
                  : [],
                error: null,
              })),
            })),
          })),
        })),
      };
    }),
  };
  return { client, inserts };
}

describe("dispatchRecordingRiskAlerts", () => {
  it("sends high-risk notifications for high severity alerts only", async () => {
    const { client, inserts } = createDispatchClient();

    const sent = await dispatchRecordingRiskAlerts({
      client: client as never,
      organizationId: "org-1",
      assetId: "asset-1",
      assetTitle: "周五晚黄金档",
      alerts: [
        highAlert(),
        highAlert({ severity: "medium", term: "私下交易", atSeconds: 300 }),
      ],
    });

    expect(sent).toBe(1);
    expect(inserts).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        recipient_role: "ops_manager",
        notification_type: "high_risk",
        is_high_risk: true,
        object_type: "recording_asset",
        object_id: "asset-1",
        title: "录屏高危告警：周五晚黄金档",
      }),
    ]);
  });

  it("dedupes alerts that were already notified for the same source", async () => {
    const alert = highAlert();
    const { client, inserts } = createDispatchClient([
      riskAlertNotificationSource("asset-1", alert),
    ]);

    const sent = await dispatchRecordingRiskAlerts({
      client: client as never,
      organizationId: "org-1",
      assetId: "asset-1",
      assetTitle: "周五晚黄金档",
      alerts: [alert],
    });

    expect(sent).toBe(0);
    expect(inserts).toEqual([]);
  });
});
