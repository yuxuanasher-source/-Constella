import { z } from "zod";

import type { AgentOutput } from "./contracts";

// 所有走 enrichAgentOutputWithLlm 的诊断类 Agent 共用的 prompt 模板与结构化
// schema 的唯一来源。prompt 措辞、JSON 结构或 factRefs 语义变更时必须升版本,
// 版本号随每次调用写入 ai_invocations,用于线上区分新旧 prompt 的回退率与效果。
export const ENRICHMENT_PROMPT_VERSION = 2;

export const enrichmentSchema = z.object({
  findings: z
    .array(
      z.object({
        summary: z.string().trim().min(1),
        factRefs: z.array(z.number().int().nonnegative()).min(1),
      }),
    )
    .min(1),
  caveats: z.array(z.object({ summary: z.string().trim().min(1) })).optional(),
  recommendations: z
    .array(
      z.object({
        proposal: z.string().trim().min(1),
        expectedImpact: z.string().trim().min(1).optional(),
        factRefs: z.array(z.number().int().nonnegative()).optional(),
      }),
    )
    .min(1),
});

export type EnrichmentModelOutput = z.infer<typeof enrichmentSchema>;

export function buildAgentSystemPrompt(role: string): string {
  return [
    role,
    "严格规则:",
    "1. 只能依据下方提供的事实,不得编造任何数据、平台信息或外部因素。",
    "2. findings(结论)、caveats(风险提示)、recommendations(建议)中的数字只能逐字复述事实列表里已有的数字,不得计算、换算或引入新数字;无法溯源的数值一律改用定性描述,例如「偏低」「明显高于均值」「显著下滑」。",
    "3. 所有建议都必须经人工确认后才能执行,不要给出可直接自动执行的指令。",
    "4. 使用简洁、专业、可执行的中文。",
    "5. 每条 finding 必须带 factRefs 数组,填写它所依据的事实编号(至少一个);只能引用事实列表中出现的 [n] 编号,不得虚构编号。",
    '6. 只返回 JSON,结构为:{"findings":[{"summary":"...","factRefs":[0]}],"caveats":[{"summary":"..."}],"recommendations":[{"proposal":"...","expectedImpact":"...","factRefs":[0]}]}。',
  ].join("\n");
}

export function buildEnrichmentUserPrompt({
  contextLines = [],
  facts,
}: {
  contextLines?: string[];
  facts: AgentOutput["facts"];
}): string {
  return [
    ...contextLines,
    "以下是事实数据(每条前面的 [n] 是事实编号):",
    ...facts.map((fact, index) => `[${index}] ${fact.statement}`),
    "",
    "请基于以上事实输出结论(findings)、风险提示(caveats)与改进建议(recommendations),并为每条 finding 标注 factRefs。",
  ].join("\n");
}
