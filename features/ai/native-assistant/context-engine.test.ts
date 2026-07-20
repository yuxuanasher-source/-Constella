import { describe, expect, it } from "vitest";

import { buildNativeAssistantContext } from "./context-engine";

describe("native assistant context engine", () => {
  it("derives actor identity from server auth and computes role read scopes", () => {
    expect(
      buildNativeAssistantContext({
        auth: {
          userId: USER_ID,
          organizationId: ORG_ID,
          role: "finance",
        },
        conversationId: CONVERSATION_ID,
        clientRequest: {
          message: "查一下结算风险",
          pageContext: { pageType: "finance_batch", objectIds: [BATCH_ID] },
          attachmentIds: ["attachment-1"],
        },
        skillGrantsHash: "grants-v1",
      }),
    ).toEqual({
      assistant: {
        displayName: "星耀 AI",
        kernelId: "hermes-agent-fork",
      },
      message: "查一下结算风险",
      pageContext: { pageType: "finance_batch", objectIds: [BATCH_ID] },
      attachmentIds: ["attachment-1"],
      actor: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: "finance",
        conversationId: CONVERSATION_ID,
        allowedReadScopes: [
          "context.read",
          "projects.search",
          "projects.summary",
          "knowledge.search",
          "settlements.summary",
        ],
        skillGrantsHash: "grants-v1",
        profileVersion: "hermes-xingyao-v1",
      },
    });
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
        clientRequest: { message: "hello" },
        skillGrantsHash: "grants-v1",
      }),
    ).toBeNull();
  });
});

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
