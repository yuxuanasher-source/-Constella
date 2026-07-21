import { describe, expect, it } from "vitest";

import {
  NATIVE_XINGYAO_ASSISTANT,
  parseNativeAssistantClientRequest,
} from "./contracts";

describe("native Xingyao assistant contract", () => {
  it("keeps the public display name while pinning Hermes to an internal kernel", () => {
    expect(NATIVE_XINGYAO_ASSISTANT).toEqual({
      displayName: "星耀 AI",
      kernelId: "hermes-agent-official-gateway",
    });
  });

  it("accepts only product input and a mode, never model routing", () => {
    expect(
      parseNativeAssistantClientRequest({
        message: "  总结当前项目风险  ",
        mode: "deep",
        pageContext: { pageType: "project", objectIds: [UUID_A] },
        attachmentIds: [" attachment-1 ", "attachment-2"],
      }),
    ).toEqual({
      message: "总结当前项目风险",
      mode: "deep",
      pageContext: { pageType: "project", objectIds: [UUID_A] },
      attachmentIds: ["attachment-1", "attachment-2"],
    });

    expect(
      parseNativeAssistantClientRequest({ message: "use the default mode" }),
    ).toEqual({
      message: "use the default mode",
      mode: "fast",
      attachmentIds: [],
    });
    expect(
      parseNativeAssistantClientRequest({ message: "hello", mode: "turbo" }),
    ).toBeNull();

    for (const forbiddenKey of [
      "organizationId",
      "userId",
      "role",
      "allowedReadScopes",
      "enabledSkillVersions",
      "skillGrantsHash",
      "provider",
      "model",
      "fallbackModel",
      "fallbackProviders",
      "reasoningEffort",
      "maxIterations",
    ]) {
      expect(
        parseNativeAssistantClientRequest({
          message: "hello",
          [forbiddenKey]: "client-controlled",
        }),
      ).toBeNull();
    }
  });
});

const UUID_A = "11111111-1111-4111-8111-111111111111";
