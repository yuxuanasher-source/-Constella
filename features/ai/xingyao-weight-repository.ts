// 星耀 AI 助手 · 风险权重仓库。
// 把学习闭环校准后的特征权重持久化到既有的 scoring_weights 表
// （organization_id + weight_key 唯一，weight_bps 被数据库约束在 0-10000），
// 读取时用组织级覆盖值合并默认权重——诊断准确率随数据积累持续提升，
// 但任何时刻缺失覆盖值都能安全退回默认模型。

import {
  DEFAULT_XINGYAO_RISK_WEIGHTS,
  XINGYAO_RISK_MODELS,
  type XingyaoRiskModel,
  type XingyaoRiskWeights,
} from "./xingyao-risk-radar";
import { clampBps } from "./xingyao-feature-store";

export const XINGYAO_WEIGHT_KEY_PREFIX = "xingyao";

export type XingyaoWeightRow = {
  weight_key: string;
  weight_bps: number;
};

export type XingyaoWeightRepositoryClient = {
  from(table: "scoring_weights"): {
    select(columns: "weight_key, weight_bps"): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        like(
          column: "weight_key",
          pattern: string,
        ): PromiseLike<{
          data: XingyaoWeightRow[] | null;
          error: { message?: string } | Error | null;
        }>;
      };
    };
    upsert(
      payload: Record<string, unknown>[],
      options: { onConflict: "organization_id,weight_key" },
    ): PromiseLike<{ error: { message?: string } | Error | null }>;
  };
};

export function weightKeyFor(model: XingyaoRiskModel, signal: string): string {
  return `${XINGYAO_WEIGHT_KEY_PREFIX}.${model}.${signal}`;
}

export function flattenXingyaoWeights(
  weights: XingyaoRiskWeights,
): XingyaoWeightRow[] {
  const rows: XingyaoWeightRow[] = [];
  for (const model of XINGYAO_RISK_MODELS) {
    for (const signal of Object.keys(weights[model]).sort()) {
      rows.push({
        weight_key: weightKeyFor(model, signal),
        weight_bps: clampBps(weights[model][signal]),
      });
    }
  }
  return rows;
}

// 覆盖值合并：只认识默认模型中已声明的信号键，未知键忽略，
// 防止脏数据把新信号悄悄注入评分模型。
export function mergeXingyaoWeightRows(
  rows: XingyaoWeightRow[],
): XingyaoRiskWeights {
  const merged = {} as XingyaoRiskWeights;
  for (const model of XINGYAO_RISK_MODELS) {
    merged[model] = { ...DEFAULT_XINGYAO_RISK_WEIGHTS[model] };
  }
  for (const row of rows) {
    const parts = row.weight_key.split(".");
    if (parts.length !== 3 || parts[0] !== XINGYAO_WEIGHT_KEY_PREFIX) continue;
    const model = parts[1] as XingyaoRiskModel;
    const signal = parts[2];
    if (!XINGYAO_RISK_MODELS.includes(model)) continue;
    if (!(signal in merged[model])) continue;
    merged[model][signal] = clampBps(row.weight_bps);
  }
  return merged;
}

export async function loadXingyaoRiskWeights(
  client: XingyaoWeightRepositoryClient,
  organizationId: string,
): Promise<XingyaoRiskWeights> {
  const { data, error } = await client
    .from("scoring_weights")
    .select("weight_key, weight_bps")
    .eq("organization_id", organizationId)
    .like("weight_key", `${XINGYAO_WEIGHT_KEY_PREFIX}.%`);
  if (error) {
    throw error instanceof Error
      ? error
      : new Error(error.message ?? "Failed to load xingyao weights");
  }
  return mergeXingyaoWeightRows(data ?? []);
}

export async function saveXingyaoRiskWeights(
  client: XingyaoWeightRepositoryClient,
  {
    organizationId,
    weights,
    updatedBy,
  }: {
    organizationId: string;
    weights: XingyaoRiskWeights;
    updatedBy?: string;
  },
): Promise<number> {
  const rows = flattenXingyaoWeights(weights).map((row) => ({
    organization_id: organizationId,
    weight_key: row.weight_key,
    weight_bps: row.weight_bps,
    status: "active",
    ...(updatedBy ? { created_by: updatedBy } : {}),
  }));
  const { error } = await client
    .from("scoring_weights")
    .upsert(rows, { onConflict: "organization_id,weight_key" });
  if (error) {
    throw error instanceof Error
      ? error
      : new Error(error.message ?? "Failed to save xingyao weights");
  }
  return rows.length;
}
