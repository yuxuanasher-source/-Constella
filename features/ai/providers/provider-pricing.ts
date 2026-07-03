import type { AiUsageEstimateInput } from "../contracts";

// 各 provider 的粗略估算单价(分 / 百万 token),替代旧的
// 「ceil(tokens/1000) 分」占位口径。仅用于用量看板的成本展示,
// 上线前请按实际合同价核对;真实成本以供应商账单为准。
const PRICING: Record<
  string,
  { promptCentsPerMTok: number; completionCentsPerMTok: number }
> = {
  deepseek: { promptCentsPerMTok: 200, completionCentsPerMTok: 800 },
  hunyuan: { promptCentsPerMTok: 300, completionCentsPerMTok: 900 },
  openai: { promptCentsPerMTok: 1800, completionCentsPerMTok: 7200 },
};

export function estimateProviderCostCents(
  providerName: string,
  input: AiUsageEstimateInput,
): number {
  const promptTokens = nonnegativeInt(input.promptTokens);
  const completionTokens = nonnegativeInt(input.completionTokens);
  if (promptTokens + completionTokens === 0) {
    return 0;
  }

  const rates = PRICING[providerName];
  if (!rates) {
    return Math.max(1, Math.ceil((promptTokens + completionTokens) / 1000));
  }

  const cents =
    (promptTokens * rates.promptCentsPerMTok +
      completionTokens * rates.completionCentsPerMTok) /
    1_000_000;
  return Math.max(1, Math.ceil(cents));
}

function nonnegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}
