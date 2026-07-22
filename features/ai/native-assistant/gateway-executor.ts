import type {
  ConversationResponseOutcome,
  ConversationStreamEvent,
} from "../conversation-contracts";
import type { AiAttachment, AiProviderName } from "../contracts";
import type {
  ConversationTurnExecutor,
  ConversationTurnExecutorInput,
} from "../conversation-stream-adapter";
import type { CreatedConversationTurn } from "../conversation-repository";
import type { ConversationActor } from "../conversation-service";
import { buildGatewayNativeAssistantContext } from "./context-engine";

type GatewayService = {
  prepareTurn(
    actor: ConversationActor,
    turnId: string,
    groundingRefs?: string[],
  ): Promise<{
    turn: { mode: "fast" | "deep" };
    snapshot: { version: number; summaryVersion: number };
  }>;
  listMessages(
    actor: ConversationActor,
    conversationId: string,
  ): Promise<Array<Parameters<typeof buildGatewayNativeAssistantContext>[0]["messages"][number]>>;
  getGatewayState?(
    actor: ConversationActor,
    conversationId: string,
  ): Promise<{
    generation: number;
    sessionId?: string;
    summary?: Record<string, unknown>;
    summaryVersion?: number;
  } | null>;
  compareAndSwapGatewayState(
    actor: ConversationActor,
    conversationId: string,
    expectedGeneration: number,
    nextState: Record<string, unknown>,
  ): Promise<number>;
  syncConversationSummary?(
    actor: ConversationActor,
    conversationId: string,
    input: { expectedSummaryVersion: number; summary: Record<string, unknown> },
  ): Promise<void>;
  finishTurnV2(
    actor: ConversationActor,
    turnId: string,
    input: {
      invocationId: string;
      outcome: "complete" | "partial" | "blocked" | "failed" | "cancelled";
      content?: string;
      providerName?: AiProviderName | null;
      errorCode?: string | null;
      errorSummary?: string | null;
      retryable: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  renewLeaseV2?(actor: ConversationActor, turnId: string): Promise<void>;
};

type GatewayClient = {
  createSession(input: Record<string, unknown>): Promise<{ sessionId: string }>;
  branchSession?(input: Record<string, unknown>): Promise<{ sessionId: string }>;
  submitPrompt(input: Record<string, unknown>): AsyncIterable<GatewayRuntimeEvent>;
};

type GatewayRuntimeEvent =
  | {
      type: "activity";
      label?: unknown;
      status?: unknown;
      reasoning?: unknown;
    }
  | {
      type: "tool.started";
      toolCallId?: unknown;
      toolName?: unknown;
      label?: unknown;
    }
  | {
      type: "tool.completed";
      toolCallId?: unknown;
      toolName?: unknown;
      status?: unknown;
      label?: unknown;
      evidenceRefs?: unknown;
      missing?: unknown;
      observedAt?: unknown;
      critical?: unknown;
    }
  | { type: "text.delta"; delta?: unknown }
  | { type: "completed"; sessionId?: unknown; summary?: unknown }
  | { type: "failed"; code?: unknown; retryable?: unknown }
  | { type: "cancelled"; invocationId?: unknown };

type GatewayExecutorOptions = {
  service: GatewayService;
  gateway?: GatewayClient;
  auth: {
    userId: string;
    organizationId: string;
    role: string;
  };
  provider: AiProviderName;
  model: string;
  personalMemoryRevision?: number;
  now?: () => Date;
};

export function createGatewayTurnExecutor(
  options: GatewayExecutorOptions,
): ConversationTurnExecutor<Omit<GatewayService, "listMessages">> {
  const gateway = options.gateway ?? createUnavailableGatewayClient();
  return {
    async *execute(input: ConversationTurnExecutorInput<Omit<GatewayService, "listMessages">>) {
      const service = options.service;
      const now = options.now ?? (() => new Date());
      const prepared = await service.prepareTurn(input.actor, input.turn.turnId, []);
      const messages = await service.listMessages(
        input.actor,
        input.turn.conversationId,
      );
      const body = await readJsonBody(input.request);
      const context = buildGatewayNativeAssistantContext({
        auth: options.auth,
        conversationId: input.turn.conversationId,
        invocationId: input.turn.turnId,
        clientRequest: {
          message: stringValue(body.message) ?? latestUserMessage(messages),
          mode: body.mode === "deep" ? "deep" : prepared.turn.mode,
          pageContext: body.pageContext,
          attachmentIds: input.attachments.map((attachment) => attachment.fileId).filter(isString),
        },
        personalMemoryRevision: options.personalMemoryRevision ?? 0,
        messages,
      });
      if (!context) {
        throw new Error("Hermes Gateway context is invalid");
      }

      yield started(input.turn);
      yield {
        type: "context.ready",
        conversationId: input.turn.conversationId,
        turnId: input.turn.turnId,
        snapshotVersion: prepared.snapshot.version,
      };

      const state = (await service.getGatewayState?.(
        input.actor,
        input.turn.conversationId,
      )) ?? { generation: 0 };
      const session =
        state.sessionId && input.turn.attempt > 1 && gateway.branchSession
          ? await gateway.branchSession({
              sessionId: state.sessionId,
              actor: context.actor,
              checkpoint: {
                conversationId: input.turn.conversationId,
                turnId: input.turn.turnId,
                attempt: input.turn.attempt,
              },
            })
          : await gateway.createSession({
              actor: context.actor,
              budget: context.budget,
              personalMemoryRevision: context.personalMemoryRevision,
              transcript: context.ledgerTranscript,
              attachments: normalizeAttachmentUpload(input.attachments),
            });
      const nextGeneration = state.generation + 1;
      await service.compareAndSwapGatewayState(
        input.actor,
        input.turn.conversationId,
        state.generation,
        {
          generation: nextGeneration,
          sessionId: session.sessionId,
          provider: options.provider,
          model: options.model,
          rebuiltAt: now().toISOString(),
        },
      );

      let content = "";
      const observations: ToolObservation[] = [];
      for await (const gatewayEvent of gateway.submitPrompt({
        sessionId: session.sessionId,
        prompt: context.message,
        actor: context.actor,
        provider: options.provider,
        model: options.model,
      })) {
        if (gatewayEvent.type === "completed") {
          const outcome = classifyOutcome(observations);
          const metadata = completionMetadata({
            observations,
            provider: options.provider,
            model: options.model,
          });
          if (isRecord(gatewayEvent.summary) && service.syncConversationSummary) {
            await service.syncConversationSummary(input.actor, input.turn.conversationId, {
              expectedSummaryVersion: prepared.snapshot.summaryVersion,
              summary: gatewayEvent.summary,
            });
          }
          await service.finishTurnV2(input.actor, input.turn.turnId, {
            invocationId: input.turn.turnId,
            outcome,
            content,
            providerName: options.provider,
            errorCode: null,
            errorSummary: null,
            retryable: false,
            metadata,
          });
          yield {
            type: "response.completed",
            conversationId: input.turn.conversationId,
            turnId: input.turn.turnId,
            messageId: input.turn.assistantMessageId,
            content,
            outcome,
            evidence: metadata.evidence,
            missing: metadata.missing,
            observationTimes: metadata.observationTimes,
            meta: metadata,
            ...(stringValue(gatewayEvent.sessionId) ? { invocationId: input.turn.turnId } : {}),
          };
          return;
        }
        if (gatewayEvent.type === "failed") {
          const traceCode = `gateway_${stringValue(gatewayEvent.code) ?? "provider_failed"}`;
          await service.finishTurnV2(input.actor, input.turn.turnId, {
            invocationId: input.turn.turnId,
            outcome: "failed",
            content,
            providerName: options.provider,
            errorCode: traceCode,
            errorSummary: traceCode,
            retryable: gatewayEvent.retryable === true,
            metadata: {
              traceCode,
              provider: options.provider,
              model: options.model,
            },
          });
          yield {
            type: "response.failed",
            conversationId: input.turn.conversationId,
            turnId: input.turn.turnId,
            code: traceCode,
            retryable: gatewayEvent.retryable === true,
            message: traceCode,
            invocationId: input.turn.turnId,
          };
          return;
        }
        if (gatewayEvent.type === "cancelled") {
          await service.finishTurnV2(input.actor, input.turn.turnId, {
            invocationId: input.turn.turnId,
            outcome: "cancelled",
            content,
            providerName: options.provider,
            errorCode: "turn_cancelled",
            errorSummary: "Turn cancelled",
            retryable: false,
            metadata: { provider: options.provider, model: options.model },
          });
          yield {
            type: "response.cancelled",
            conversationId: input.turn.conversationId,
            turnId: input.turn.turnId,
            messageId: input.turn.assistantMessageId,
            invocationId: input.turn.turnId,
          };
          return;
        }
        const event = normalizeGatewayEvent(gatewayEvent, input.turn);
        if (!event) continue;
        if (event.type === "response.delta") content += event.delta;
        if (event.type === "tool.completed") {
          observations.push({
            status: event.status,
            evidence: event.evidence ?? [],
            missing: event.missing ?? [],
            observedAt: event.observedAt,
            critical:
              gatewayEvent.type === "tool.completed" &&
              gatewayEvent.critical === true,
          });
        }
        yield event;
      }

      await service.finishTurnV2(input.actor, input.turn.turnId, {
        invocationId: input.turn.turnId,
        outcome: "failed",
        content,
        providerName: options.provider,
        errorCode: "gateway_stream_ended",
        errorSummary: "Gateway stream ended before a terminal event",
        retryable: true,
        metadata: { traceCode: "gateway_stream_ended", provider: options.provider, model: options.model },
      });
      yield {
        type: "response.failed",
        conversationId: input.turn.conversationId,
        turnId: input.turn.turnId,
        code: "gateway_stream_ended",
        retryable: true,
        message: "Gateway stream ended before a terminal event",
      };
    },
  };
}

function createUnavailableGatewayClient(): GatewayClient {
  return {
    async createSession() {
      return { sessionId: "gateway-unconfigured" };
    },
    async *submitPrompt() {
      yield {
        type: "failed",
        code: "gateway_unconfigured",
        retryable: true,
      };
    },
  };
}

type ToolObservation = {
  status: "completed" | "failed" | "denied";
  evidence: string[];
  missing: string[];
  observedAt?: string;
  critical: boolean;
};

function classifyOutcome(observations: ToolObservation[]): ConversationResponseOutcome {
  if (observations.length === 0) return "complete";
  const successful = observations.some((observation) => observation.status === "completed");
  const criticalFailures = observations.filter(
    (observation) =>
      observation.critical &&
      (observation.status === "failed" || observation.status === "denied"),
  );
  if (!successful && criticalFailures.length > 0) return "blocked";
  if (
    observations.some(
      (observation) =>
        observation.status === "failed" ||
        observation.status === "denied" ||
        observation.missing.length > 0,
    )
  ) {
    return "partial";
  }
  return "complete";
}

function completionMetadata({
  observations,
  provider,
  model,
}: {
  observations: ToolObservation[];
  provider: AiProviderName;
  model: string;
}) {
  const evidence = unique(observations.flatMap((observation) => observation.evidence));
  const missing = unique(observations.flatMap((observation) => observation.missing));
  const observedAt = observations
    .map((observation) => observation.observedAt)
    .filter(isString)
    .sort();
  return {
    evidence,
    missing,
    observationTimes: {
      firstObservedAt: observedAt[0] ?? null,
      lastObservedAt: observedAt.at(-1) ?? null,
    },
    provider,
    model,
  };
}

function normalizeGatewayEvent(
  event: GatewayRuntimeEvent,
  turn: CreatedConversationTurn,
): ConversationStreamEvent | null {
  if (event.type === "activity") {
    const label = stringValue(event.label);
    if (!label) return null;
    return {
      type: "activity.updated",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      label,
      status: statusValue(event.status, ["pending", "running", "completed", "failed"]) ?? "running",
    };
  }
  if (event.type === "tool.started") {
    const toolCallId = stringValue(event.toolCallId);
    const toolName = stringValue(event.toolName);
    if (!toolCallId || !toolName) return null;
    return {
      type: "tool.started",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      toolCallId,
      toolName,
      label: stringValue(event.label) ?? toolName,
    };
  }
  if (event.type === "tool.completed") {
    const toolCallId = stringValue(event.toolCallId);
    const toolName = stringValue(event.toolName);
    if (!toolCallId || !toolName) return null;
    return {
      type: "tool.completed",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      toolCallId,
      toolName,
      label: stringValue(event.label) ?? toolName,
      status: statusValue(event.status, ["completed", "failed", "denied"]) ?? "completed",
      evidence: stringList(event.evidenceRefs),
      missing: stringList(event.missing),
      ...(isString(event.observedAt) ? { observedAt: event.observedAt } : {}),
    };
  }
  if (event.type === "text.delta") {
    return {
      type: "response.delta",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      messageId: turn.assistantMessageId,
      delta: typeof event.delta === "string" ? event.delta : "",
    };
  }
  return null;
}

function started(turn: CreatedConversationTurn): ConversationStreamEvent {
  return {
    type: "turn.started",
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
  };
}

function normalizeAttachmentUpload(attachments: AiAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    fileId: attachment.fileId,
  }));
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.clone().json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function latestUserMessage(
  messages: Array<Parameters<typeof buildGatewayNativeAssistantContext>[0]["messages"][number]>,
): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function statusValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(isString).map((item) => item.trim()).filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
