import { sendNotification } from "@/lib/notify/notify";

import type { RecordingTranscriptLine } from "./recording-script-analysis";

/**
 * 违规风险检测：对转写文本与操作事件流做敏感词、平台禁播内容和违规操作
 * 识别，产出结构化告警。高危告警会立即向 ops_manager 发送高风险站内通知，
 * 处置动作（下播、封禁、驳回）始终由人工执行，系统只负责发现和留证。
 */

export type RecordingRiskCategory =
  | "sensitive_word"
  | "banned_content"
  | "violation_operation";

export type RecordingRiskSeverity = "medium" | "high";

export type RecordingOperationEvent = {
  atSeconds: number;
  kind: string;
  detail?: string;
};

export type RecordingRiskAlert = {
  category: RecordingRiskCategory;
  severity: RecordingRiskSeverity;
  term: string;
  atSeconds: number;
  message: string;
  evidence: Record<string, unknown>;
};

export type RecordingRiskLexicon = {
  sensitiveWords: Array<{ term: string; severity: RecordingRiskSeverity }>;
  bannedContent: Array<{ term: string; reason: string }>;
  violationOperations: Array<{
    kind: string;
    severity: RecordingRiskSeverity;
    reason: string;
  }>;
};

export const defaultRecordingRiskLexicon: RecordingRiskLexicon = {
  sensitiveWords: [
    { term: "赌博", severity: "high" },
    { term: "博彩", severity: "high" },
    { term: "外围", severity: "high" },
    { term: "上分代充", severity: "high" },
    { term: "外挂", severity: "high" },
    { term: "脚本代练", severity: "medium" },
    { term: "私下交易", severity: "medium" },
    { term: "加我微信", severity: "medium" },
    { term: "线下转账", severity: "medium" },
    { term: "稳赚不赔", severity: "medium" },
    { term: "必出货", severity: "medium" },
  ],
  bannedContent: [
    { term: "未成年人充值", reason: "平台禁止引导未成年人充值消费" },
    { term: "返现", reason: "平台禁止站外返现引流" },
    { term: "抽奖内定", reason: "虚假抽奖属于平台禁播内容" },
    { term: "盗版资源", reason: "传播盗版资源属于平台禁播内容" },
  ],
  violationOperations: [
    {
      kind: "off_platform_redirect",
      severity: "high",
      reason: "把观众导流到站外平台，触发平台外链违规",
    },
    {
      kind: "account_sharing",
      severity: "high",
      reason: "直播中展示账号共享/买卖，触发账号安全违规",
    },
    {
      kind: "afk_streaming",
      severity: "medium",
      reason: "长时间挂机录播，可能被平台判定无效直播",
    },
    {
      kind: "screen_privacy_leak",
      severity: "medium",
      reason: "画面泄露隐私信息（手机号、后台数据），需要复核",
    },
  ],
};

export function detectRecordingRisks({
  transcript = [],
  operationEvents = [],
  lexicon = defaultRecordingRiskLexicon,
}: {
  transcript?: RecordingTranscriptLine[];
  operationEvents?: RecordingOperationEvent[];
  lexicon?: RecordingRiskLexicon;
}): RecordingRiskAlert[] {
  const alerts: RecordingRiskAlert[] = [];

  for (const line of transcript) {
    const text = line.text.trim();
    if (!text) {
      continue;
    }

    for (const entry of lexicon.sensitiveWords) {
      if (text.includes(entry.term)) {
        alerts.push({
          category: "sensitive_word",
          severity: entry.severity,
          term: entry.term,
          atSeconds: normalizeSeconds(line.atSeconds),
          message: `话术命中敏感词「${entry.term}」，请复核该时间点上下文。`,
          evidence: { excerpt: excerpt(text), matchedTerm: entry.term },
        });
      }
    }

    for (const entry of lexicon.bannedContent) {
      if (text.includes(entry.term)) {
        alerts.push({
          category: "banned_content",
          severity: "high",
          term: entry.term,
          atSeconds: normalizeSeconds(line.atSeconds),
          message: `疑似平台禁播内容「${entry.term}」：${entry.reason}。`,
          evidence: { excerpt: excerpt(text), matchedTerm: entry.term },
        });
      }
    }
  }

  for (const event of operationEvents) {
    const rule = lexicon.violationOperations.find(
      (entry) => entry.kind === event.kind,
    );
    if (!rule) {
      continue;
    }
    alerts.push({
      category: "violation_operation",
      severity: rule.severity,
      term: event.kind,
      atSeconds: normalizeSeconds(event.atSeconds),
      message: `检测到违规操作「${event.kind}」：${rule.reason}。`,
      evidence: {
        kind: event.kind,
        detail: event.detail ?? null,
      },
    });
  }

  return alerts.sort((left, right) => left.atSeconds - right.atSeconds);
}

type RiskAlertDispatchClient = {
  from(table: "notifications"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          limit(count: number): PromiseLike<{
            data: Array<{ id: string }> | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
};

/**
 * 高危告警即时通知：同一资产同一告警源只发一次（按 source 去重），
 * 避免重复分析时刷屏。返回实际发送的通知数量。
 */
export async function dispatchRecordingRiskAlerts({
  client,
  organizationId,
  assetId,
  assetTitle,
  alerts,
}: {
  client: RiskAlertDispatchClient;
  organizationId: string;
  assetId: string;
  assetTitle: string;
  alerts: RecordingRiskAlert[];
}): Promise<number> {
  let sentCount = 0;

  for (const alert of alerts) {
    if (alert.severity !== "high") {
      continue;
    }

    const source = riskAlertNotificationSource(assetId, alert);
    if (await notificationExists(client, organizationId, source)) {
      continue;
    }

    await sendNotification(client, {
      organizationId,
      recipientRole: "ops_manager",
      type: "high_risk",
      title: `录屏高危告警：${assetTitle || "未命名录屏"}`,
      content: alert.message,
      objectType: "recording_asset",
      objectId: assetId,
      source,
      isHighRisk: true,
    });
    sentCount += 1;
  }

  return sentCount;
}

export function riskAlertNotificationSource(
  assetId: string,
  alert: RecordingRiskAlert,
): string {
  return `recording_risk:${assetId}:${alert.category}:${alert.term}:${alert.atSeconds}`;
}

async function notificationExists(
  client: RiskAlertDispatchClient,
  organizationId: string,
  source: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("notifications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source", source)
    .limit(1);

  if (error) {
    throw error;
  }

  return (data ?? []).length > 0;
}

function excerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function normalizeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
