import { describe, expect, it } from "vitest";

import {
  assertProductionGrade,
  auditAiProduction,
  auditGatewayInvocation,
  type ProductionAuditInput,
} from "./production-auditor";
import type { AiGatewayResult } from "./contracts";

function baseInput(
  overrides: Partial<ProductionAuditInput> = {},
): ProductionAuditInput {
  return {
    authenticity: {
      modelName: "hunyuan-pro",
      requestId: "req_abc123",
      traceId: "trace_xyz789",
      promptInput: [{ role: "user", content: "复盘项目利润" }],
      responseOutput: { 结论: "利润达标" },
      usage: { promptTokens: 320, completionTokens: 180, totalTokens: 500 },
      latencyMs: 1240,
      timestamp: "2026-06-26T09:00:00.000Z",
    },
    output: {
      结论: "项目毛利率 41.67%，高于续约阈值",
      建议: "维持当前主播配置，继续采样两周",
      可执行动作: [
        {
          动作: "schedule_project_review",
          业务对象: "project",
          对象ID: "proj-1",
          需人工审批: true,
        },
      ],
    },
    businessMapping: ["project"],
    objectType: "project",
    objectId: "proj-1",
    processNode: "复盘",
    invocationId: "00000000-0000-4000-8000-000000000001",
    costCents: 6,
    ...overrides,
  };
}

describe("auditAiProduction — 通过路径", () => {
  it("四道闸门齐全时判定通过且可信等级为高", () => {
    const verdict = auditAiProduction(baseInput());

    expect(verdict.是否真实AI调用).toBe(true);
    expect(verdict.调用可信等级).toBe("高");
    expect(verdict.业务对象映射).toEqual(["project"]);
    expect(verdict.流程节点).toBe("复盘");
    expect(verdict.是否可执行).toBe(true);
    expect(verdict.是否可入库).toBe(true);
    expect(verdict.是否通过自检).toBe(true);
    expect(verdict.缺失字段).toEqual([]);
    expect(verdict.风险项).toEqual([]);
    expect(verdict.最终判定).toBe("通过");
  });

  it("归一化中英别名到标准业务对象与流程节点", () => {
    const verdict = auditAiProduction(
      baseInput({
        businessMapping: undefined,
        objectType: "live_report",
        objectId: "report-9",
        processNode: "auto_review",
      }),
    );

    expect(verdict.业务对象映射).toEqual(["review"]);
    expect(verdict.流程节点).toBe("审核");
    expect(verdict.最终判定).toBe("通过");
  });
});

describe("闸门一：真实性", () => {
  it("缺失任意真实性字段判定为非真实 AI 调用且可信等级为无", () => {
    const verdict = auditAiProduction(
      baseInput({
        authenticity: {
          modelName: "",
          requestId: null,
          traceId: null,
          promptInput: "",
          responseOutput: undefined,
          usage: { promptTokens: 1 },
          latencyMs: null,
          timestamp: "not-a-date",
        },
      }),
    );

    expect(verdict.是否真实AI调用).toBe(false);
    expect(verdict.调用可信等级).toBe("无");
    expect(verdict.缺失字段).toEqual(
      expect.arrayContaining([
        "model_name",
        "request_id",
        "prompt_input",
        "response_output",
        "token_usage",
        "latency",
        "timestamp",
      ]),
    );
    expect(verdict.最终判定).toBe("不通过");
  });

  it("仅提供 traceId 也视为具备 request_id", () => {
    const verdict = auditAiProduction(
      baseInput({
        authenticity: {
          ...baseInput().authenticity,
          requestId: null,
          traceId: "trace-only",
        },
      }),
    );

    expect(verdict.缺失字段).not.toContain("request_id");
    expect(verdict.是否真实AI调用).toBe(true);
  });

  it("token_usage 缺少 input 或 output 时判定缺失", () => {
    const verdict = auditAiProduction(
      baseInput({
        authenticity: {
          ...baseInput().authenticity,
          usage: { promptTokens: 100 },
        },
      }),
    );

    expect(verdict.缺失字段).toContain("token_usage");
    expect(verdict.是否真实AI调用).toBe(false);
  });
});

describe("闸门二：业务落地性", () => {
  it("无法映射业务对象时标记不可落地", () => {
    const verdict = auditAiProduction(
      baseInput({ businessMapping: ["unknown_thing"], objectType: undefined }),
    );

    expect(verdict.业务对象映射).toEqual([]);
    expect(verdict.缺失字段).toContain("business_object_mapping");
    expect(verdict.风险项).toEqual(
      expect.arrayContaining(["不可落地：无法映射任何 ERP 业务对象"]),
    );
    expect(verdict.最终判定).toBe("不通过");
  });
});

describe("闸门三：流程嵌入", () => {
  it("未绑定流程节点时标记 AI 能力未进入业务流", () => {
    const verdict = auditAiProduction(baseInput({ processNode: undefined }));

    expect(verdict.流程节点).toBeNull();
    expect(verdict.缺失字段).toContain("process_node");
    expect(verdict.风险项).toEqual(
      expect.arrayContaining(["AI 能力未进入业务流：未绑定任何流程节点"]),
    );
    expect(verdict.最终判定).toBe("不通过");
  });
});

describe("闸门四：结构化输出", () => {
  it("自然语言字符串输出判定为非结构化", () => {
    const verdict = auditAiProduction(
      baseInput({ output: "这个项目利润不错，建议继续。" }),
    );

    expect(verdict.缺失字段).toContain("structured_output");
    expect(verdict.是否可执行).toBe(false);
    expect(verdict.是否可入库).toBe(false);
    expect(verdict.最终判定).toBe("不通过");
  });

  it("结论与可执行动作均为空判定为非结构化", () => {
    const verdict = auditAiProduction(
      baseInput({ output: { 结论: "", 建议: "随便看看", 可执行动作: [] } }),
    );

    expect(verdict.缺失字段).toContain("structured_output");
    expect(verdict.最终判定).toBe("不通过");
  });
});

describe("治理：高风险动作不能自动执行", () => {
  it("声明自动执行但缺人工审批判定越权且不通过", () => {
    const verdict = auditAiProduction(
      baseInput({
        output: {
          结论: "异常账单需锁定",
          可执行动作: [
            {
              动作: "lock_settlement_batch",
              业务对象: "settlement",
              对象ID: "batch-1",
              自动执行: true,
            },
          ],
        },
      }),
    );

    expect(verdict.是否可执行).toBe(false);
    expect(verdict.是否通过自检).toBe(false);
    expect(verdict.风险项.join("")).toContain("越权");
    expect(verdict.最终判定).toBe("不通过");
  });
});

describe("可执行 / 可入库 / 可信等级", () => {
  it("无动作但可映射业务对象且有 invocation 时可入库通过", () => {
    const verdict = auditAiProduction(
      baseInput({
        output: { 结论: "结论可入库", 可执行动作: [] },
      }),
    );

    expect(verdict.是否可执行).toBe(false);
    expect(verdict.是否可入库).toBe(true);
    expect(verdict.最终判定).toBe("通过");
  });

  it("缺少 invocation 与计费时可信等级降为中", () => {
    const verdict = auditAiProduction(
      baseInput({ invocationId: undefined, costCents: 0 }),
    );

    expect(verdict.调用可信等级).toBe("中");
    expect(verdict.风险项).toEqual(
      expect.arrayContaining(["未绑定 ai_invocations 记录：无法审计与追踪"]),
    );
  });
});

describe("assertProductionGrade", () => {
  it("通过时返回裁决结果", () => {
    const verdict = assertProductionGrade(baseInput());
    expect(verdict.最终判定).toBe("通过");
  });

  it("不合格时抛出「不合格 AI 输出」并携带风险摘要", () => {
    expect(() =>
      assertProductionGrade(baseInput({ processNode: undefined })),
    ).toThrowError(/不合格 AI 输出/);
  });
});

describe("auditGatewayInvocation 适配器", () => {
  it("从网关结果与业务上下文构造并通过裁决", () => {
    const gatewayResult: AiGatewayResult = {
      status: "succeeded",
      providerName: "deterministic",
      fallbackUsed: false,
      structuredOutput: {
        结论: "主播留存达标",
        建议: "进入正常排班",
        可执行动作: [
          { 动作: "confirm_schedule", 业务对象: "schedule", 需人工审批: true },
        ],
      },
      usage: { promptTokens: 200, completionTokens: 120, totalTokens: 320 },
      latencyMs: 800,
      costCents: 4,
    };

    const verdict = auditGatewayInvocation({
      gatewayResult,
      modelName: "deterministic-v1",
      requestId: "req-1",
      traceId: "trace-1",
      promptInput: "排班建议",
      timestamp: "2026-06-26T10:00:00.000Z",
      invocationId: "00000000-0000-4000-8000-000000000002",
      objectType: "live_task",
      objectId: "task-1",
      processNode: "排班",
    });

    expect(verdict.业务对象映射).toEqual(["schedule"]);
    expect(verdict.流程节点).toBe("排班");
    expect(verdict.是否真实AI调用).toBe(true);
    expect(verdict.最终判定).toBe("通过");
  });

  it("网关返回非结构化文本时判定不通过", () => {
    const gatewayResult: AiGatewayResult = {
      status: "degraded",
      fallbackUsed: false,
      degradedReason: "provider_unconfigured",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      costCents: 0,
    };

    const verdict = auditGatewayInvocation({
      gatewayResult,
      processNode: "风控",
      objectType: "streamer",
      objectId: "streamer-1",
    });

    expect(verdict.最终判定).toBe("不通过");
    expect(verdict.缺失字段).toContain("structured_output");
  });
});
