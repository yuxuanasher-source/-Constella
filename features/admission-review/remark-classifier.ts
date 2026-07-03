import { z } from "zod";

import type { AiProvider, AiProviderName } from "@/features/ai/contracts";
import { runAiGateway } from "@/features/ai/llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "@/features/ai/provider-registry";

import {
  checkpointsForStage,
  normalizeReasonCodes,
  type AdmissionRubric,
} from "./contracts";

// 厂家驳回备注归一化：厂家端零新增填写负担（只写自由文本 remark），
// 由 LLM 事后分类到统一理由码；LLM 不可用/低置信时退回关键词规则。
// 低置信结果只作参考（confidence=low），不阻塞任何业务流。

export const REMARK_CLASSIFY_SCENE = "admission.classify_vendor_remark";
export const REMARK_CLASSIFY_PROMPT_VERSION = 1;

export type RemarkClassification = {
  reasonCodes: string[];
  confidence: "high" | "medium" | "low";
  source: "llm" | "deterministic";
  providerName?: AiProviderName;
  errorSummary?: string;
};

// 关键词兜底规则：短语命中 → 理由码。顺序无关，全部累积。
const KEYWORD_RULES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /违规|违禁|夸大|承诺|红线|敏感/, code: "compliance_violation" },
  { pattern: /没有?声音|无声|花屏|黑屏|看不清|模糊|卡顿|时长太短|太短/, code: "media_unusable" },
  { pattern: /不是本人|换人|人不符|不一致/, code: "identity_mismatch" },
  { pattern: /话术|卖点|台词|讲解|口播内容/, code: "script_fit" },
  { pattern: /节奏|开场|拖沓|冷场|收尾/, code: "rhythm_pacing" },
  { pattern: /互动|评论|弹幕|引导|转化/, code: "interaction_guidance" },
  { pattern: /画质|音质|收音|灯光|清晰度/, code: "media_quality" },
  { pattern: /形象|气质|风格|调性|不搭|不符合品牌/, code: "persona_fit" },
  { pattern: /设备|环境|背景|场地|网络/, code: "equipment_env" },
];

const classificationSchema = z.object({
  reasonCodes: z.array(z.string().trim().min(1)).min(1).max(4),
  confidence: z.enum(["high", "medium", "low"]),
});

export function classifyRemarkDeterministic({
  remark,
  rubric,
}: {
  remark: string;
  rubric: AdmissionRubric;
}): RemarkClassification {
  const allowed = new Set(
    checkpointsForStage(rubric, "vendor_second").map((c) => c.key),
  );
  const codes = KEYWORD_RULES.filter(
    (rule) => allowed.has(rule.code) && rule.pattern.test(remark),
  ).map((rule) => rule.code);
  const unique = [...new Set(codes)];

  return {
    reasonCodes: unique,
    confidence: unique.length ? "medium" : "low",
    source: "deterministic",
  };
}

export async function classifyVendorRemark({
  remark,
  rubric,
  providers,
  primaryProvider,
  runGateway = runAiGateway,
}: {
  remark: string;
  rubric: AdmissionRubric;
  providers?: AiProvider[];
  primaryProvider?: AiProviderName;
  runGateway?: typeof runAiGateway;
}): Promise<RemarkClassification> {
  const normalizedRemark = remark.trim();
  if (!normalizedRemark) {
    return { reasonCodes: [], confidence: "low", source: "deterministic" };
  }

  const resolvedProviders = (
    providers ?? createConfiguredAiProviders()
  ).filter((provider) => provider.name !== "deterministic");
  const routing = primaryProvider
    ? { primaryProvider }
    : resolveAiProviderRouting();

  if (
    !resolvedProviders.some((provider) =>
      provider.capabilities.includes("structured"),
    )
  ) {
    return classifyRemarkDeterministic({ remark: normalizedRemark, rubric });
  }

  const stageCheckpoints = checkpointsForStage(rubric, "vendor_second");
  const result = await runGateway({
    providers: resolvedProviders,
    primaryProvider: routing.primaryProvider,
    request: {
      kind: "structured",
      promptKey: REMARK_CLASSIFY_SCENE,
      promptVersion: REMARK_CLASSIFY_PROMPT_VERSION,
      messages: [
        {
          role: "system",
          content: [
            "你是 MCN 审核理由分类器。把厂家对主播录屏的驳回备注归类到理由码。",
            "可用理由码（只能从中选择，最多 4 个）:",
            ...stageCheckpoints.map(
              (checkpoint) =>
                `- ${checkpoint.key}: ${checkpoint.label}（${checkpoint.description}）`,
            ),
            '只返回 JSON: {"reasonCodes":["..."],"confidence":"high|medium|low"}。',
            "备注含义模糊或与所有理由码无关时，选最接近的一项并给 low confidence。",
          ].join("\n"),
        },
        { role: "user", content: `厂家备注：${normalizedRemark}` },
      ],
      responseSchema: classificationSchema,
    },
  });

  if (result.status !== "succeeded") {
    const fallback = classifyRemarkDeterministic({
      remark: normalizedRemark,
      rubric,
    });
    return {
      ...fallback,
      errorSummary: result.errorSummary ?? "remark classification failed",
    };
  }

  const parsed = classificationSchema.safeParse(result.structuredOutput);
  if (!parsed.success) {
    return classifyRemarkDeterministic({ remark: normalizedRemark, rubric });
  }

  // LLM 可能编造理由码；先过滤到阶段可用集合，全部无效则退回规则。
  const allowedCodes = parsed.data.reasonCodes.filter((code) =>
    stageCheckpoints.some((checkpoint) => checkpoint.key === code.trim()),
  );
  const reasonCodes = normalizeReasonCodes(
    rubric,
    "vendor_second",
    allowedCodes,
  );
  if (!reasonCodes.length) {
    return classifyRemarkDeterministic({ remark: normalizedRemark, rubric });
  }

  return {
    reasonCodes,
    confidence: parsed.data.confidence,
    source: "llm",
    providerName: result.providerName,
  };
}
