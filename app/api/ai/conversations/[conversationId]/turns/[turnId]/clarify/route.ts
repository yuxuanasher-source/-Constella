import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
  type AiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import { activeHermesRunRegistry } from "@/features/ai/hermes/active-run-registry";
import {
  createHermesGatewaySession,
  resolveHermesGatewayConfig,
} from "@/features/ai/hermes/gateway-client";
import {
  createHermesActorAssertionForRun,
  resolveHermesRuntimeConfig,
} from "@/features/ai/hermes/runtime-client";
import { buildNativeAssistantContext } from "@/features/ai/native-assistant/context-engine";

export const maxDuration = 330;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string; turnId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;
    const { conversationId, turnId } = await params;
    const body = await request.json().catch(() => null);
    const command = parseClarifyCommand(body);
    if (!command) {
      return NextResponse.json(
        { error: "A valid clarifyId and answer are required" },
        { status: 400 },
      );
    }

    const turn = await requireOwnedTurn(
      context.service,
      context.actor,
      conversationId,
      turnId,
    );
    const state = (await context.service.getGatewayState(
      context.actor,
      conversationId,
    )) as
      | (Record<string, unknown> & { generation: number; sessionId?: string })
      | null;
    const recoveryControl = await getRecoveryControlState(
      context.service,
      context.actor,
      conversationId,
      turnId,
    );
    const pending = pendingClarify(
      recoveryControl.available ? recoveryControl.controlState : state,
      recoveryControl.available ? turnId : undefined,
    );
    const childSessionIds = recoveryControl.available
      ? stringList(recoveryControl.controlState.childSessionIds)
      : stringList(state?.childSessions);
    const duplicate = duplicateClarifyResponse(pending, command);
    if (duplicate === "duplicate") {
      return NextResponse.json({ duplicate: true });
    }
    if (duplicate === "conflict") {
      return NextResponse.json(
        { error: "Clarify response conflicts with the prior answer" },
        { status: 409 },
      );
    }
    if (
      !pending ||
      pending.turnId !== turnId ||
      pending.clarifyId !== command.clarifyId
    ) {
      return NextResponse.json(
        { error: "Clarify request is no longer pending" },
        { status: 409 },
      );
    }
    if (!isAllowedClarifyAnswer(command.answer, pending)) {
      return NextResponse.json(
        { error: "Clarify answer is not allowed" },
        { status: 422 },
      );
    }
    const answerSha256 = answerHash(command.answer);
    const claim = await appendClarifyResponse(
      context.service,
      context.actor,
      conversationId,
      turnId,
      pending,
      childSessionIds,
      command.clarifyId,
      answerSha256,
      "claimed",
    );
    if (claim.status === "duplicate") {
      return NextResponse.json({ duplicate: true });
    }
    if (claim.status === "conflict") {
      return NextResponse.json(
        { error: "Clarify response conflicts with the prior answer" },
        { status: 409 },
      );
    }

    const local = await activeHermesRunRegistry.respondToClarify({
      actor: context.actor,
      conversationId,
      turnId,
      clarifyId: command.clarifyId,
      answer: command.answer,
    });
    if (local.status !== "accepted" && local.status !== "duplicate") {
      if (!state?.sessionId) {
        return NextResponse.json(
          { error: "Gateway session is unavailable" },
          { status: 409 },
        );
      }
      try {
        const session = await openControlSession({
          context,
          conversationId,
          turnId,
          turn,
          sessionId: state.sessionId,
        });
        try {
          await session.respondToClarify({
            requestId: command.clarifyId,
            answer: command.answer,
          });
        } finally {
          session.close?.();
        }
      } catch (error) {
        if (isMissingGatewaySession(error)) {
          return recoveryResponse(
            context.service,
            context.actor,
            conversationId,
            turnId,
          );
        }
        throw error;
      }
    }

    await appendClarifyResponse(
      context.service,
      context.actor,
      conversationId,
      turnId,
      pending,
      childSessionIds,
      command.clarifyId,
      answerSha256,
      "delivered",
    );

    return NextResponse.json({ accepted: true });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}

type ClarifyCommand = { clarifyId: string; answer: string };
type PendingClarify = {
  turnId: string;
  clarifyId: string;
  requestId?: string;
  question: string;
  choices: string[];
  allowFreeText: boolean;
  response?: {
    clarifyId: string;
    answer?: string;
    answerSha256?: string;
    status?: "claimed" | "delivered";
  };
};

function parseClarifyCommand(value: unknown): ClarifyCommand | null {
  if (!isRecord(value)) return null;
  const clarifyId =
    typeof value.clarifyId === "string" ? value.clarifyId.trim() : "";
  const answer = typeof value.answer === "string" ? value.answer.trim() : "";
  if (!clarifyId || !answer || answer.length > 12_000) return null;
  return { clarifyId, answer };
}

function pendingClarify(
  state: Record<string, unknown> | null,
  fallbackTurnId?: string,
): PendingClarify | null {
  const pending = isRecord(state?.pendingClarify) ? state.pendingClarify : null;
  if (!pending) return null;
  const turnId = stringValue(pending.turnId) ?? fallbackTurnId ?? null;
  const clarifyId = stringValue(pending.clarifyId);
  const requestId = stringValue(pending.requestId);
  const question = stringValue(pending.question);
  const choices = Array.isArray(pending.choices)
    ? pending.choices.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
  if (!turnId || !clarifyId || !question) return null;
  return {
    turnId,
    clarifyId,
    ...(requestId ? { requestId } : {}),
    question,
    choices,
    allowFreeText: pending.allowFreeText === true,
    ...(isRecord(pending.response)
      ? { response: pending.response as PendingClarify["response"] }
      : {}),
  };
}

function duplicateClarifyResponse(
  pending: PendingClarify | null,
  command: ClarifyCommand,
): "new" | "duplicate" | "conflict" {
  if (!pending?.response || pending.response.clarifyId !== command.clarifyId)
    return "new";
  const existingHash =
    stringValue(pending.response.answerSha256) ??
    (stringValue(pending.response.answer)
      ? answerHash(stringValue(pending.response.answer)!)
      : null);
  if (!existingHash) return "conflict";
  if (existingHash !== answerHash(command.answer)) return "conflict";
  return pending.response.status === "claimed" ? "new" : "duplicate";
}

function isAllowedClarifyAnswer(
  answer: string,
  pending: PendingClarify,
): boolean {
  return pending.allowFreeText || pending.choices.includes(answer.trim());
}

async function openControlSession({
  context,
  conversationId,
  turnId,
  turn,
  sessionId,
}: {
  context: AiConversationRouteContext;
  conversationId: string;
  turnId: string;
  turn: { mode?: "fast" | "deep" };
  sessionId: string;
}) {
  const actor = buildControlActor(
    context.auth,
    conversationId,
    turnId,
    turn.mode ?? "fast",
  );
  const capability = await context.service.issueGatewayRootCapability(
    context.actor,
    {
      actor,
      mode: turn.mode ?? "fast",
      turn: { id: turnId, conversationId },
      serverAllowedTools: [],
      approvedSkillDraftIds: [],
      aiStateWritesAllowed: false,
    },
  );
  const config = resolveHermesGatewayConfig();
  const actorAssertionConfig = resolveHermesRuntimeConfig();
  if (!config || !actorAssertionConfig)
    throw new Error("gateway_config_missing");
  return createHermesGatewaySession({
    config,
    actor,
    actorAssertion: await createHermesActorAssertionForRun({
      actor,
      config: actorAssertionConfig,
      runtime: "gateway",
    }),
    invocationCapability: capability.invocationCapability,
    conversationId,
    sessionId,
  });
}

async function requireOwnedTurn(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
) {
  const history = await service.getHistory(actor, conversationId);
  const turn = Array.isArray(history?.turns)
    ? history.turns.find((item) => item.id === turnId)
    : null;
  if (!turn) throw new Error("Turn not found");
  if (
    !["accepted", "grounding", "generating", "validating"].includes(
      String(turn.status),
    )
  ) {
    throw new Error("Turn is not active");
  }
  return turn;
}

function buildControlActor(
  auth: { userId: string; organizationId: string; role: string },
  conversationId: string,
  turnId: string,
  mode: "fast" | "deep",
) {
  const context = buildNativeAssistantContext({
    auth,
    conversationId,
    invocationId: turnId,
    runtime: "gateway",
    clientRequest: { message: "control", mode, attachmentIds: [] },
  });
  if (!context) throw new Error("gateway_actor_invalid");
  return context.actor;
}

async function recoveryResponse(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
) {
  const appendRecoveryEvent = recoveryService(service).appendRecoveryEvent;
  if (appendRecoveryEvent) {
    await appendRecoveryEvent.call(service, actor, conversationId, turnId, {
      eventName: "session_ready",
      payload: {
        recovery: "rebuild_required",
        reason: "gateway_session_missing",
      },
    });
  }
  return NextResponse.json({ recovery: "rebuild_required" }, { status: 202 });
}

type ClarifyClaim = { status: "claimed" | "duplicate" | "conflict" };

type RecoveryCompatibleService = {
  getRecoverySnapshot?: (
    actor: AiConversationRouteContext["actor"],
    conversationId: string,
    turnId: string,
  ) => Promise<unknown>;
  appendRecoveryEvent?: (
    actor: AiConversationRouteContext["actor"],
    conversationId: string,
    turnId: string,
    event: Record<string, unknown>,
  ) => Promise<unknown>;
};

async function getRecoveryControlState(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
): Promise<
  | { available: true; controlState: Record<string, unknown> }
  | { available: false; controlState: null }
> {
  const getRecoverySnapshot = recoveryService(service).getRecoverySnapshot;
  if (!getRecoverySnapshot) return { available: false, controlState: null };
  const snapshot = await getRecoverySnapshot.call(
    service,
    actor,
    conversationId,
    turnId,
  );
  if (
    !isRecord(snapshot) ||
    !isRecord(snapshot.controlState) ||
    (snapshot.eventSequence === 0 &&
      Object.keys(snapshot.controlState).length === 0)
  ) {
    return { available: false, controlState: null };
  }
  return { available: true, controlState: snapshot.controlState };
}

async function appendClarifyResponse(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
  pending: PendingClarify,
  childSessionIds: string[],
  clarifyId: string,
  answerSha256: string,
  status: "claimed" | "delivered",
): Promise<ClarifyClaim> {
  const appendRecoveryEvent = recoveryService(service).appendRecoveryEvent;
  if (!appendRecoveryEvent) {
    throw new Error("turn_recovery_unavailable");
  }
  const result = await appendRecoveryEvent.call(
    service,
    actor,
    conversationId,
    turnId,
    {
      eventName: "clarify_answered",
      payload: { clarifyId, answerSha256, status },
      controlState: {
        childSessionIds,
        pendingClarify: {
          turnId,
          clarifyId: pending.clarifyId,
          ...(pending.requestId ? { requestId: pending.requestId } : {}),
          question: pending.question,
          choices: pending.choices,
          allowFreeText: pending.allowFreeText,
          response: { clarifyId, answerSha256, status },
        },
      },
    },
  );
  if (isRecord(result) && result.operationStatus === "duplicate") {
    return { status: "duplicate" };
  }
  if (isRecord(result) && result.operationStatus === "conflict") {
    return { status: "conflict" };
  }
  return { status: "claimed" };
}

function recoveryService(
  service: AiConversationRouteContext["service"],
): RecoveryCompatibleService {
  return service as unknown as RecoveryCompatibleService;
}

function answerHash(answer: string): string {
  return createHash("sha256").update(answer.trim(), "utf8").digest("hex");
}

function isMissingGatewaySession(error: unknown): boolean {
  return (
    error instanceof Error &&
    /session_(mismatch|missing|not_found)|not_found/i.test(error.message)
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
