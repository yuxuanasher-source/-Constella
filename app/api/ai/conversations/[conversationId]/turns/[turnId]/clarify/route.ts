import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
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
      return NextResponse.json({ error: "A valid clarifyId and answer are required" }, { status: 400 });
    }

    const turn = await requireOwnedTurn(context.service, context.actor, conversationId, turnId);
    const state = (await context.service.getGatewayState(context.actor, conversationId)) as
      | (Record<string, unknown> & { generation: number; sessionId?: string })
      | null;
    const pending = pendingClarify(state);
    const duplicate = duplicateClarifyResponse(pending, command);
    if (duplicate === "duplicate") {
      return NextResponse.json({ duplicate: true });
    }
    if (duplicate === "conflict") {
      return NextResponse.json({ error: "Clarify response conflicts with the prior answer" }, { status: 409 });
    }
    if (!pending || pending.turnId !== turnId || pending.clarifyId !== command.clarifyId) {
      return NextResponse.json({ error: "Clarify request is no longer pending" }, { status: 409 });
    }
    if (!isAllowedClarifyAnswer(command.answer, pending)) {
      return NextResponse.json({ error: "Clarify answer is not allowed" }, { status: 422 });
    }
    const answerSha256 = answerHash(command.answer);
    const claim = await context.service.claimClarifyResponse(
      context.actor,
      conversationId,
      turnId,
      { clarifyId: command.clarifyId, answerSha256 },
    );
    if (claim.status === "duplicate") {
      return NextResponse.json({ duplicate: true });
    }
    if (claim.status === "conflict") {
      return NextResponse.json({ error: "Clarify response conflicts with the prior answer" }, { status: 409 });
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
        return NextResponse.json({ error: "Gateway session is unavailable" }, { status: 409 });
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
          return recoveryResponse(context.service, context.actor, conversationId, state);
        }
        throw error;
      }
    }

    return NextResponse.json({ accepted: true });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}

type ClarifyCommand = { clarifyId: string; answer: string };
type PendingClarify = {
  turnId: string;
  clarifyId: string;
  choices: string[];
  allowFreeText: boolean;
  response?: { clarifyId: string; answer?: string; answerSha256?: string };
};

function parseClarifyCommand(value: unknown): ClarifyCommand | null {
  if (!isRecord(value)) return null;
  const clarifyId = typeof value.clarifyId === "string" ? value.clarifyId.trim() : "";
  const answer = typeof value.answer === "string" ? value.answer.trim() : "";
  if (!clarifyId || !answer || answer.length > 12_000) return null;
  return { clarifyId, answer };
}

function pendingClarify(state: Record<string, unknown> | null): PendingClarify | null {
  const pending = isRecord(state?.pendingClarify) ? state.pendingClarify : null;
  if (!pending) return null;
  const turnId = stringValue(pending.turnId);
  const clarifyId = stringValue(pending.clarifyId);
  const choices = Array.isArray(pending.choices)
    ? pending.choices.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (!turnId || !clarifyId) return null;
  return {
    turnId,
    clarifyId,
    choices,
    allowFreeText: pending.allowFreeText === true,
    ...(isRecord(pending.response) ? { response: pending.response as PendingClarify["response"] } : {}),
  };
}

function duplicateClarifyResponse(
  pending: PendingClarify | null,
  command: ClarifyCommand,
): "new" | "duplicate" | "conflict" {
  if (!pending?.response || pending.response.clarifyId !== command.clarifyId) return "new";
  const existingHash =
    stringValue(pending.response.answerSha256) ??
    (stringValue(pending.response.answer)
      ? answerHash(stringValue(pending.response.answer)!)
      : null);
  if (!existingHash) return "conflict";
  return existingHash === answerHash(command.answer) ? "duplicate" : "conflict";
}

function isAllowedClarifyAnswer(answer: string, pending: PendingClarify): boolean {
  return pending.allowFreeText || pending.choices.includes(answer.trim());
}

async function openControlSession({
  context,
  conversationId,
  turnId,
  turn,
  sessionId,
}: {
  context: any;
  conversationId: string;
  turnId: string;
  turn: { mode?: "fast" | "deep" };
  sessionId: string;
}) {
  const actor = buildControlActor(context.auth, conversationId, turnId, turn.mode ?? "fast");
  const capability = await context.service.issueGatewayRootCapability(context.actor, {
    actor,
    mode: turn.mode ?? "fast",
    turn: { id: turnId, conversationId },
    serverAllowedTools: [],
    approvedSkillDraftIds: [],
    aiStateWritesAllowed: false,
  });
  const config = resolveHermesGatewayConfig();
  const actorAssertionConfig = resolveHermesRuntimeConfig();
  if (!config || !actorAssertionConfig) throw new Error("gateway_config_missing");
  return createHermesGatewaySession({
    config,
    actor,
    actorAssertion: await createHermesActorAssertionForRun({
      actor,
      config: actorAssertionConfig,
    }),
    invocationCapability: capability.invocationCapability,
    conversationId,
    sessionId,
  });
}

async function requireOwnedTurn(
  service: any,
  actor: { organizationId: string; userId: string },
  conversationId: string,
  turnId: string,
) {
  const history = await service.getHistory(actor, conversationId);
  const turn = Array.isArray(history?.turns)
    ? history.turns.find((item: any) => item?.id === turnId || item?.turnId === turnId)
    : null;
  if (!turn) throw new Error("Turn not found");
  if (!["accepted", "grounding", "generating", "validating"].includes(String(turn.status))) {
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
  service: any,
  actor: { organizationId: string; userId: string },
  conversationId: string,
  state: { generation: number; summary?: Record<string, unknown>; summaryVersion?: number },
) {
  await service.compareAndSwapGatewayState(actor, conversationId, state.generation, {
    generation: state.generation + 1,
    summary: state.summary ?? {},
    summaryVersion: state.summaryVersion ?? 0,
    recovery: {
      status: "rebuild_required",
      reason: "gateway_session_missing",
    },
  });
  return NextResponse.json({ recovery: "rebuild_required" }, { status: 202 });
}

function answerHash(answer: string): string {
  return createHash("sha256").update(answer.trim(), "utf8").digest("hex");
}

function isMissingGatewaySession(error: unknown): boolean {
  return error instanceof Error && /session_(mismatch|missing|not_found)|not_found/i.test(error.message);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
