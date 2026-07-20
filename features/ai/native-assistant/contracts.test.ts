import { describe, expect, it } from "vitest";

import {
  NATIVE_XINGYAO_ASSISTANT,
  parseNativeAssistantClientRequest,
} from "./contracts";

describe("native Xingyao assistant contract", () => {
  it("keeps the public display name while pinning Hermes to an internal kernel", () => {
    expect(NATIVE_XINGYAO_ASSISTANT).toEqual({
      displayName: "星耀 AI",
      kernelId: "hermes-agent-fork",
    });
  });

  it("accepts only message, pageContext, and attachmentIds from the client", () => {
    expect(
      parseNativeAssistantClientRequest({
        message: "  总结当前项目风险  ",
        pageContext: { pageType: "project", objectIds: [UUID_A] },
        attachmentIds: [" attachment-1 ", "attachment-2"],
      }),
    ).toEqual({
      message: "总结当前项目风险",
      pageContext: { pageType: "project", objectIds: [UUID_A] },
      attachmentIds: ["attachment-1", "attachment-2"],
    });

    for (const forbiddenKey of [
      "organizationId",
      "userId",
      "role",
      "allowedReadScopes",
      "enabledSkillVersions",
      "skillGrantsHash",
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
