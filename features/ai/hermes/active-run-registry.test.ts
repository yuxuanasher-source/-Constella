import { describe, expect, it, vi } from "vitest";

import {
  activeRunKey,
  createActiveRunRegistry,
  type ActiveRunActor,
} from "./active-run-registry";

const actor: ActiveRunActor = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
};
const conversationId = "33333333-3333-4333-8333-333333333333";
const turnId = "44444444-4444-4444-8444-444444444444";
const clarifyId = "66666666-6666-4666-8666-666666666666";

describe("Hermes active run registry", () => {
  it("binds local fast-path keys to organization, user, conversation, and turn", () => {
    const key = activeRunKey({ actor, conversationId, turnId });

    expect(key).toContain(actor.organizationId);
    expect(key).toContain(actor.userId);
    expect(key).toContain(conversationId);
    expect(key).toContain(turnId);
  });

  it("does not allow a guessed conversation and turn to cross actor boundaries", async () => {
    const registry = createActiveRunRegistry();
    const session = {
      interrupt: vi.fn().mockResolvedValue({ interrupted: true }),
      respondToClarify: vi.fn(),
      close: vi.fn(),
    };
    registry.register({ actor, conversationId, turnId, sessionId: "session-owner", session });

    expect(
      registry.get({
        actor: { ...actor, userId: "55555555-5555-4555-8555-555555555555" },
        conversationId,
        turnId,
      }),
    ).toBeNull();
    await expect(
      registry.interrupt({
        actor: { ...actor, userId: "55555555-5555-4555-8555-555555555555" },
        conversationId,
        turnId,
      }),
    ).resolves.toBe(false);
    expect(session.interrupt).not.toHaveBeenCalled();
  });

  it("requires clarify responses to match the pending request, option policy, and active turn", async () => {
    const registry = createActiveRunRegistry();
    const session = {
      interrupt: vi.fn(),
      respondToClarify: vi.fn().mockResolvedValue({ accepted: true }),
      close: vi.fn(),
    };
    registry.register({ actor, conversationId, turnId, sessionId: "session-owner", session });
    registry.setPendingClarify({
      actor,
      conversationId,
      turnId,
      clarifyId,
      choices: ["project", "streamer"],
      allowFreeText: false,
    });

    await expect(
      registry.respondToClarify({
        actor,
        conversationId,
        turnId,
        clarifyId: "77777777-7777-4777-8777-777777777777",
        answer: "project",
      }),
    ).resolves.toMatchObject({ status: "not_pending" });
    await expect(
      registry.respondToClarify({
        actor,
        conversationId,
        turnId,
        clarifyId,
        answer: "free text",
      }),
    ).resolves.toMatchObject({ status: "invalid_answer" });
    await expect(
      registry.respondToClarify({
        actor,
        conversationId,
        turnId,
        clarifyId,
        answer: "project",
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(session.respondToClarify).toHaveBeenCalledWith({
      requestId: clarifyId,
      answer: "project",
    });
  });

  it("treats duplicate clarify responses as idempotent and changed responses as conflicts", () => {
    const registry = createActiveRunRegistry();
    registry.recordClarifyResponse({
      actor,
      conversationId,
      turnId,
      clarifyId,
      answer: "project",
    });

    expect(
      registry.checkClarifyIdempotency({
        actor,
        conversationId,
        turnId,
        clarifyId,
        answer: "project",
      }),
    ).toBe("duplicate");
    expect(
      registry.checkClarifyIdempotency({
        actor,
        conversationId,
        turnId,
        clarifyId,
        answer: "streamer",
      }),
    ).toBe("conflict");
  });

  it("interrupts registered child sessions before the parent session", async () => {
    const registry = createActiveRunRegistry();
    const order: string[] = [];
    registry.register({
      actor,
      conversationId,
      turnId,
      sessionId: "parent-session",
      session: {
        interrupt: vi.fn(async () => order.push("parent")),
        respondToClarify: vi.fn(),
        close: vi.fn(),
      },
    });
    registry.register({
      actor,
      conversationId,
      turnId: "88888888-8888-4888-8888-888888888888",
      parentTurnId: turnId,
      sessionId: "child-session",
      session: {
        interrupt: vi.fn(async () => order.push("child")),
        respondToClarify: vi.fn(),
        close: vi.fn(),
      },
    });

    await expect(
      registry.interruptTree({ actor, conversationId, turnId }),
    ).resolves.toEqual({
      interrupted: 2,
      parentInterrupted: true,
      interruptedSessionIds: ["child-session", "parent-session"],
    });
    expect(order).toEqual(["child", "parent"]);
  });

  it("snapshots actor-scoped child and parent session IDs without crossing tenants", () => {
    const registry = createActiveRunRegistry();
    const session = {
      interrupt: vi.fn(),
      respondToClarify: vi.fn(),
      close: vi.fn(),
    };
    registry.register({
      actor,
      conversationId,
      turnId,
      sessionId: "parent-session",
      session,
    });
    registry.register({
      actor,
      conversationId,
      turnId: "88888888-8888-4888-8888-888888888888",
      parentTurnId: turnId,
      sessionId: "child-session",
      session,
    });
    registry.register({
      actor: { ...actor, userId: "99999999-9999-4999-8999-999999999999" },
      conversationId,
      turnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parentTurnId: turnId,
      sessionId: "other-tenant-session",
      session,
    });

    expect(
      registry.treeSessionIds({ actor, conversationId, turnId }),
    ).toEqual(["child-session", "parent-session"]);
  });

  it("interrupts a repeated session ID only once across the local run tree", async () => {
    const registry = createActiveRunRegistry();
    const interrupt = vi.fn();
    const session = {
      interrupt,
      respondToClarify: vi.fn(),
      close: vi.fn(),
    };
    registry.register({
      actor,
      conversationId,
      turnId,
      sessionId: "shared-session",
      session,
    });
    registry.register({
      actor,
      conversationId,
      turnId: "88888888-8888-4888-8888-888888888888",
      parentTurnId: turnId,
      sessionId: "shared-session",
      session,
    });
    registry.register({
      actor,
      conversationId,
      turnId: "99999999-9999-4999-8999-999999999999",
      parentTurnId: turnId,
      sessionId: "shared-session",
      session,
    });

    await expect(
      registry.interruptTree({ actor, conversationId, turnId }),
    ).resolves.toEqual({
      interrupted: 1,
      parentInterrupted: true,
      interruptedSessionIds: ["shared-session"],
    });
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it("continues interrupting the run tree after one local session fails", async () => {
    const registry = createActiveRunRegistry();
    const parentInterrupt = vi.fn().mockResolvedValue({ interrupted: true });
    registry.register({
      actor,
      conversationId,
      turnId,
      sessionId: "parent-session",
      session: {
        interrupt: parentInterrupt,
        respondToClarify: vi.fn(),
        close: vi.fn(),
      },
    });
    registry.register({
      actor,
      conversationId,
      turnId: "88888888-8888-4888-8888-888888888888",
      parentTurnId: turnId,
      sessionId: "child-session",
      session: {
        interrupt: vi.fn().mockRejectedValue(new Error("interrupt_failed")),
        respondToClarify: vi.fn(),
        close: vi.fn(),
      },
    });

    await expect(
      registry.interruptTree({ actor, conversationId, turnId }),
    ).resolves.toEqual({
      interrupted: 1,
      parentInterrupted: true,
      interruptedSessionIds: ["parent-session"],
      failedSessionIds: ["child-session"],
    });
    expect(parentInterrupt).toHaveBeenCalledTimes(1);
  });
});
