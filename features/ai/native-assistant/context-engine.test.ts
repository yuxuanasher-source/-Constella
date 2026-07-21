import { describe, expect, it } from "vitest";

import { computeHermesSkillGrantsHash } from "../hermes/actor-fingerprint";
import { buildNativeAssistantContext } from "./context-engine";

describe("native assistant context engine", () => {
  it("defaults to the Legacy runtime identity", () => {
    const context = buildNativeAssistantContext({
      auth: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: "finance",
      },
      conversationId: CONVERSATION_ID,
      invocationId: INVOCATION_ID,
      clientRequest: {
        message: "check settlement risk",
        pageContext: { pageType: "finance_batch", objectIds: [BATCH_ID] },
        attachmentIds: ["attachment-1"],
      },
    });

    expect(context).toMatchObject({
      assistant: {
        displayName: "星耀 AI",
        kernelId: "hermes-agent-fork",
      },
      message: "check settlement risk",
      mode: "fast",
      pageContext: { pageType: "finance_batch", objectIds: [BATCH_ID] },
      attachmentIds: ["attachment-1"],
      actor: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: "finance",
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        allowedReadScopes: [
          "context.read",
          "projects.search",
          "projects.summary",
          "knowledge.search",
          "settlements.summary",
        ],
        enabledSkillVersions: [
          expect.objectContaining({ skillId: "business-context" }),
          expect.objectContaining({ skillId: "settlement-analysis" }),
        ],
        profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
        pageContext: { pageType: "finance_batch", objectIds: [BATCH_ID] },
      },
      skillAudit: {
        type: "hermes.skill_grants.evaluated",
        profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
        enabledSkillIds: ["business-context", "settlement-analysis"],
      },
    });
    expect(context?.actor.skillGrantsHash).toBe(
      computeHermesSkillGrantsHash(context?.actor.enabledSkillVersions ?? []),
    );
    expect(context?.skillAudit.profileVersion).toBe(
      context?.actor.profileVersion,
    );
  });

  it("selects Gateway v2 only when explicitly requested", () => {
    const context = buildNativeAssistantContext({
      auth: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: "finance",
      },
      conversationId: CONVERSATION_ID,
      invocationId: INVOCATION_ID,
      runtime: "gateway",
      clientRequest: {
        message: "deep settlement review",
        mode: "deep",
      },
    });

    expect(context).toMatchObject({
      assistant: {
        displayName: "星耀 AI",
        kernelId: "hermes-agent-official-gateway",
      },
      mode: "deep",
      actor: {
        profileVersion: "hermes-xingyao-v2",
      },
      skillAudit: {
        profileVersion: "hermes-xingyao-v2",
      },
    });
    expect(context?.skillAudit.profileVersion).toBe(
      context?.actor.profileVersion,
    );
  });

  it("fails closed for unknown server roles", () => {
    expect(
      buildNativeAssistantContext({
        auth: {
          userId: USER_ID,
          organizationId: ORG_ID,
          role: "admin",
        },
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        clientRequest: { message: "hello" },
      }),
    ).toBeNull();
  });
});

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
const INVOCATION_ID = "66666666-6666-4666-8666-666666666666";
