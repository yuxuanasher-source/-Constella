import { createHash } from "node:crypto";

export type ActiveRunActor = {
  organizationId: string;
  userId: string;
};

export type ActiveRunSession = {
  interrupt(): Promise<unknown>;
  respondToClarify(input: { requestId: string; answer: string }): Promise<unknown>;
  close?(): void;
};

export type ActiveRunIdentity = {
  actor: ActiveRunActor;
  conversationId: string;
  turnId: string;
};

export type ActiveRunRegistration = ActiveRunIdentity & {
  sessionId: string;
  session: ActiveRunSession;
  parentTurnId?: string;
};

export type PendingClarify = ActiveRunIdentity & {
  clarifyId: string;
  choices: string[];
  allowFreeText: boolean;
};

type ActiveRunEntry = ActiveRunRegistration & {
  pendingClarify?: Omit<PendingClarify, keyof ActiveRunIdentity>;
  clarifyResponses: Map<string, string>;
};

export function activeRunKey(input: ActiveRunIdentity): string {
  return [
    input.actor.organizationId,
    input.actor.userId,
    input.conversationId,
    input.turnId,
  ].join(":");
}

export function createActiveRunRegistry() {
  const runs = new Map<string, ActiveRunEntry>();

  return {
    register(input: ActiveRunRegistration) {
      const key = activeRunKey(input);
      runs.set(key, { ...input, clarifyResponses: new Map() });
      return () => {
        const current = runs.get(key);
        if (current?.session === input.session) runs.delete(key);
      };
    },

    get(input: ActiveRunIdentity) {
      return runs.get(activeRunKey(input)) ?? null;
    },

    setPendingClarify(input: PendingClarify) {
      const entry = runs.get(activeRunKey(input));
      if (!entry) return false;
      entry.pendingClarify = {
        clarifyId: input.clarifyId,
        choices: [...input.choices],
        allowFreeText: input.allowFreeText,
      };
      return true;
    },

    recordClarifyResponse(input: ActiveRunIdentity & { clarifyId: string; answer: string }) {
      const entry = ensureEntry(runs, input);
      entry.clarifyResponses.set(input.clarifyId, answerHash(input.answer));
    },

    checkClarifyIdempotency(input: ActiveRunIdentity & { clarifyId: string; answer: string }) {
      const entry = runs.get(activeRunKey(input));
      const prior = entry?.clarifyResponses.get(input.clarifyId);
      if (!prior) return "new" as const;
      return prior === answerHash(input.answer) ? ("duplicate" as const) : ("conflict" as const);
    },

    async respondToClarify(input: ActiveRunIdentity & { clarifyId: string; answer: string }) {
      const entry = runs.get(activeRunKey(input));
      if (!entry?.pendingClarify) return { status: "not_pending" as const };
      const pending = entry.pendingClarify;
      if (pending.clarifyId !== input.clarifyId) {
        return { status: "not_pending" as const };
      }
      if (!isAllowedClarifyAnswer(input.answer, pending)) {
        return { status: "invalid_answer" as const };
      }
      const idempotency = this.checkClarifyIdempotency(input);
      if (idempotency === "duplicate") return { status: "duplicate" as const };
      if (idempotency === "conflict") return { status: "conflict" as const };
      await entry.session.respondToClarify({
        requestId: input.clarifyId,
        answer: input.answer,
      });
      entry.clarifyResponses.set(input.clarifyId, answerHash(input.answer));
      entry.pendingClarify = undefined;
      return { status: "accepted" as const };
    },

    async interrupt(input: ActiveRunIdentity) {
      const entry = runs.get(activeRunKey(input));
      if (!entry) return false;
      await entry.session.interrupt();
      return true;
    },

    treeSessionIds(input: ActiveRunIdentity) {
      const parentKey = activeRunKey(input);
      const childSessionIds = [...runs.values()]
        .filter(
          (entry) =>
            entry.actor.organizationId === input.actor.organizationId &&
            entry.actor.userId === input.actor.userId &&
            entry.conversationId === input.conversationId &&
            entry.parentTurnId === input.turnId,
        )
        .map((entry) => entry.sessionId);
      const parent = runs.get(parentKey);
      return [
        ...new Set([
          ...childSessionIds,
          ...(parent ? [parent.sessionId] : []),
        ]),
      ];
    },

    async interruptTree(input: ActiveRunIdentity) {
      const parentKey = activeRunKey(input);
      const children = [...runs.values()].filter(
        (entry) =>
          entry.actor.organizationId === input.actor.organizationId &&
          entry.actor.userId === input.actor.userId &&
          entry.conversationId === input.conversationId &&
          entry.parentTurnId === input.turnId,
      );
      let interrupted = 0;
      let parentInterrupted = false;
      const interruptedSessionIds: string[] = [];
      const failedSessionIds: string[] = [];
      const seenSessionIds = new Set<string>();
      for (const child of children) {
        if (seenSessionIds.has(child.sessionId)) continue;
        seenSessionIds.add(child.sessionId);
        try {
          await child.session.interrupt();
          interrupted += 1;
          interruptedSessionIds.push(child.sessionId);
        } catch {
          failedSessionIds.push(child.sessionId);
        }
      }
      const parent = runs.get(parentKey);
      if (parent) {
        if (seenSessionIds.has(parent.sessionId)) {
          parentInterrupted = interruptedSessionIds.includes(parent.sessionId);
        } else {
          seenSessionIds.add(parent.sessionId);
          try {
            await parent.session.interrupt();
            interrupted += 1;
            parentInterrupted = true;
            interruptedSessionIds.push(parent.sessionId);
          } catch {
            failedSessionIds.push(parent.sessionId);
          }
        }
      }
      return {
        interrupted,
        parentInterrupted,
        interruptedSessionIds,
        ...(failedSessionIds.length > 0 ? { failedSessionIds } : {}),
      };
    },

    clear() {
      runs.clear();
    },
  };
}

export const activeHermesRunRegistry = createActiveRunRegistry();

function ensureEntry(
  runs: Map<string, ActiveRunEntry>,
  input: ActiveRunIdentity,
): ActiveRunEntry {
  const key = activeRunKey(input);
  const existing = runs.get(key);
  if (existing) return existing;
  const entry: ActiveRunEntry = {
    ...input,
    sessionId: "",
    session: {
      interrupt: async () => undefined,
      respondToClarify: async () => undefined,
    },
    clarifyResponses: new Map(),
  };
  runs.set(key, entry);
  return entry;
}

function isAllowedClarifyAnswer(
  answer: string,
  pending: Omit<PendingClarify, keyof ActiveRunIdentity>,
): boolean {
  const normalized = answer.trim();
  if (!normalized) return false;
  return pending.allowFreeText || pending.choices.includes(normalized);
}

function answerHash(answer: string): string {
  return createHash("sha256").update(answer.trim(), "utf8").digest("hex");
}
