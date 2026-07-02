import { describe, expect, it } from "vitest";

import type { AiProvider } from "@/features/ai/contracts";
import type { runAiGateway } from "@/features/ai/llm-gateway";

import { defaultAdmissionRubric } from "./contracts";
import {
  classifyRemarkDeterministic,
  classifyVendorRemark,
} from "./remark-classifier";

const rubric = defaultAdmissionRubric();

const structuredProvider = {
  name: "deepseek",
  capabilities: ["text", "structured"],
} as unknown as AiProvider;

function gatewayReturning(output: unknown): typeof runAiGateway {
  return (() =>
    Promise.resolve({
      status: "succeeded",
      providerName: "deepseek",
      fallbackUsed: false,
      structuredOutput: output,
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      latencyMs: 200,
      costCents: 1,
    })) as unknown as typeof runAiGateway;
}

describe("classifyRemarkDeterministic", () => {
  it("maps vendor remark keywords onto vendor-stage reason codes", () => {
    const result = classifyRemarkDeterministic({
      remark: "话术完全不贴卖点，形象也和品牌调性不搭",
      rubric,
    });

    expect(result.source).toBe("deterministic");
    expect(result.reasonCodes).toEqual(["script_fit", "persona_fit"]);
    expect(result.confidence).toBe("medium");
  });

  it("returns low confidence with no codes when nothing matches", () => {
    const result = classifyRemarkDeterministic({
      remark: "整体感觉一般",
      rubric,
    });

    expect(result.reasonCodes).toEqual([]);
    expect(result.confidence).toBe("low");
  });

  it("never returns mcn-only codes for the vendor stage", () => {
    const result = classifyRemarkDeterministic({
      remark: "录屏没有声音，画面也花屏",
      rubric,
    });

    // media_unusable 是一审专属卡点，二审阶段不可用。
    expect(result.reasonCodes).not.toContain("media_unusable");
  });
});

describe("classifyVendorRemark", () => {
  it("uses the LLM classification when valid", async () => {
    const result = await classifyVendorRemark({
      remark: "主播讲解和我们产品卖点对不上",
      rubric,
      providers: [structuredProvider],
      primaryProvider: "deepseek",
      runGateway: gatewayReturning({
        reasonCodes: ["script_fit"],
        confidence: "high",
      }),
    });

    expect(result).toMatchObject({
      reasonCodes: ["script_fit"],
      confidence: "high",
      source: "llm",
      providerName: "deepseek",
    });
  });

  it("filters hallucinated codes and falls back when none survive", async () => {
    const result = await classifyVendorRemark({
      remark: "互动太少了",
      rubric,
      providers: [structuredProvider],
      primaryProvider: "deepseek",
      runGateway: gatewayReturning({
        reasonCodes: ["made_up_code"],
        confidence: "high",
      }),
    });

    expect(result.source).toBe("deterministic");
    expect(result.reasonCodes).toEqual(["interaction_guidance"]);
  });

  it("falls back to keyword rules when the gateway fails", async () => {
    const failingGateway = (() =>
      Promise.resolve({
        status: "failed",
        fallbackUsed: true,
        errorSummary: "all providers failed",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 5,
        costCents: 0,
      })) as unknown as typeof runAiGateway;

    const result = await classifyVendorRemark({
      remark: "画质模糊，灯光太暗",
      rubric,
      providers: [structuredProvider],
      primaryProvider: "deepseek",
      runGateway: failingGateway,
    });

    expect(result.source).toBe("deterministic");
    expect(result.reasonCodes).toContain("media_quality");
    expect(result.errorSummary).toBe("all providers failed");
  });

  it("goes deterministic without any real structured provider", async () => {
    const result = await classifyVendorRemark({
      remark: "话术不行",
      rubric,
      providers: [],
      runGateway: (() => {
        throw new Error("should not call gateway");
      }) as unknown as typeof runAiGateway,
    });

    expect(result.source).toBe("deterministic");
    expect(result.reasonCodes).toEqual(["script_fit"]);
  });
});
