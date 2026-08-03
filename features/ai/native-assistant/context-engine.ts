import {
  HERMES_MODE_BUDGETS,
  HERMES_PROFILE_VERSION,
  LEGACY_HERMES_PROFILE_VERSION,
  isHermesActorProfile,
  isLegacyHermesActorProfile,
  isUuid,
  type HermesActorProfile,
  type HermesSkillGrant,
} from "../hermes/contracts";
import { computeHermesSkillGrantsHash } from "../hermes/actor-fingerprint";
import { getAllowedReadScopesForRole } from "../hermes/read-scopes";
import {
  evaluateHermesSkillGrantsForActor,
  toHermesSkillGrantAuditEvent,
  type HermesSkillGrantAuditEvent,
} from "../hermes/skill-governance";
import type {
  AiConversationMessageDto,
  ConversationMemorySummary,
} from "../conversation-contracts";
import {
  LEGACY_XINGYAO_ASSISTANT,
  NATIVE_XINGYAO_ASSISTANT,
  parseNativeAssistantClientRequest,
  type NativeAssistantClientRequest,
} from "./contracts";

type BuildContextInput = {
  auth: {
    userId: string;
    organizationId: string;
    role: string;
  };
  conversationId: string;
  invocationId: string;
  runtime?: "legacy" | "gateway";
  clientRequest: unknown;
  enabledSkillVersions?: HermesSkillGrant[];
};

type BuildGatewayContextInput = BuildContextInput & {
  personalMemoryRevision: number;
  messages: AiConversationMessageDto[];
  conversationMemory?: {
    status: "ready" | "degraded";
    summaryVersion: number;
    summary: ConversationMemorySummary;
  };
};

export type NativeAssistantContext = NativeAssistantClientRequest & {
  assistant: typeof LEGACY_XINGYAO_ASSISTANT | typeof NATIVE_XINGYAO_ASSISTANT;
  actor: HermesActorProfile;
  skillAudit: HermesSkillGrantAuditEvent;
};

export type GatewayLedgerTranscriptMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  metadata?: Record<string, unknown>;
};

export type GatewayNativeAssistantContext = NativeAssistantContext & {
  personalMemoryRevision: number;
  budget: (typeof HERMES_MODE_BUDGETS)[keyof typeof HERMES_MODE_BUDGETS];
  conversationMemory: {
    status: "ready" | "degraded";
    summaryVersion: number;
    lastCompactedSequence: number;
    summary: ConversationMemorySummary;
  };
  ledgerTranscript: GatewayLedgerTranscriptMessage[];
};

export function buildNativeAssistantContext(
  input: BuildContextInput,
): NativeAssistantContext | null {
  const clientRequest = parseNativeAssistantClientRequest(input.clientRequest);
  const useGateway = input.runtime === "gateway";
  const assistant = useGateway
    ? NATIVE_XINGYAO_ASSISTANT
    : LEGACY_XINGYAO_ASSISTANT;
  const profileVersion = useGateway
    ? HERMES_PROFILE_VERSION
    : LEGACY_HERMES_PROFILE_VERSION;
  const allowedReadScopes = getAllowedReadScopesForRole(input.auth.role);
  const skillEvaluation = evaluateHermesSkillGrantsForActor({
    role: input.auth.role,
    allowedReadScopes,
  });
  const enabledSkillVersions = [
    ...(input.enabledSkillVersions ?? skillEvaluation.enabledSkillVersions),
  ].sort(compareSkillGrant);
  if (
    !clientRequest ||
    allowedReadScopes.length === 0 ||
    !isUuid(input.auth.userId) ||
    !isUuid(input.auth.organizationId) ||
    !isUuid(input.conversationId) ||
    !isUuid(input.invocationId)
  ) {
    return null;
  }

  const actor = {
    userId: input.auth.userId,
    organizationId: input.auth.organizationId,
    role: input.auth.role,
    conversationId: input.conversationId,
    invocationId: input.invocationId,
    allowedReadScopes,
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion,
    pageContext: clientRequest.pageContext ?? {
      pageType: "global",
      objectIds: [],
    },
  };

  const isExpectedActorProfile = useGateway
    ? isHermesActorProfile
    : isLegacyHermesActorProfile;
  if (!isExpectedActorProfile(actor)) {
    return null;
  }

  return {
    assistant,
    ...clientRequest,
    actor,
    skillAudit: toHermesSkillGrantAuditEvent({
      actor,
      evaluation: {
        ...skillEvaluation,
        enabledSkillVersions,
        skillGrantsHash: actor.skillGrantsHash,
      },
    }),
  };
}

export function buildGatewayNativeAssistantContext(
  input: BuildGatewayContextInput,
): GatewayNativeAssistantContext | null {
  const base = buildNativeAssistantContext({
    ...input,
    runtime: "gateway",
  });
  if (
    !base ||
    !Number.isInteger(input.personalMemoryRevision) ||
    input.personalMemoryRevision < 0
  ) {
    return null;
  }

  const conversationMemory = input.conversationMemory ?? {
    status: "ready" as const,
    summaryVersion: 0,
    summary: emptyConversationMemorySummary(),
  };
  if (
    !Number.isInteger(conversationMemory.summaryVersion) ||
    conversationMemory.summaryVersion < 0
  ) {
    return null;
  }

  return {
    ...base,
    personalMemoryRevision: input.personalMemoryRevision,
    budget: HERMES_MODE_BUDGETS[base.mode],
    conversationMemory: {
      ...conversationMemory,
      lastCompactedSequence: conversationMemory.summary.lastCompactedSequence,
    },
    ledgerTranscript: sanitizeLedgerTranscript({
      messages: input.messages,
      ownerUserId: input.auth.userId,
      afterSequence: conversationMemory.summary.lastCompactedSequence,
    }),
  };
}

function sanitizeLedgerTranscript({
  messages,
  ownerUserId,
  afterSequence,
}: {
  messages: AiConversationMessageDto[];
  ownerUserId: string;
  afterSequence: number;
}): GatewayLedgerTranscriptMessage[] {
  return messages
    .filter((message) => {
      if (message.status !== "completed") return false;
      if (message.sequence <= afterSequence) return false;
      if (
        typeof message.metadata?.ownerUserId === "string" &&
        message.metadata.ownerUserId !== ownerUserId
      ) {
        return false;
      }
      return (
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "tool"
      );
    })
    .map((message): GatewayLedgerTranscriptMessage => {
      if (message.role === "user" || message.role === "assistant") {
        return {
          role: message.role,
          content: message.content,
          metadata: transcriptIdentityMetadata(message),
        };
      }
      const metadata = sanitizeToolMessageMetadata(
        message.metadata ?? {},
        message.updatedAt,
      );
      return {
        role: "tool",
        content: message.content,
        metadata: { ...metadata, ...transcriptIdentityMetadata(message) },
      };
    });
}

function transcriptIdentityMetadata(
  message: AiConversationMessageDto,
): Record<string, unknown> {
  return {
    messageId: message.id,
    sequence: message.sequence,
    ...(message.metadata?.pinned === true ? { pinned: true } : {}),
  };
}

function sanitizeToolMessageMetadata(
  metadata: Record<string, unknown>,
  fallbackUpdatedAt: string,
): Record<string, unknown> {
  return {
    ...(typeof metadata.toolName === "string" && metadata.toolName.trim()
      ? { toolName: metadata.toolName }
      : {}),
    updatedAt:
      typeof metadata.updatedAt === "string" && metadata.updatedAt.trim()
        ? metadata.updatedAt
        : fallbackUpdatedAt,
    historical: true,
  };
}

function compareSkillGrant(
  left: HermesSkillGrant,
  right: HermesSkillGrant,
): number {
  return (
    compareAscii(left.skillId, right.skillId) ||
    compareAscii(left.version, right.version) ||
    compareAscii(left.bundleSha256, right.bundleSha256)
  );
}

function emptyConversationMemorySummary(): ConversationMemorySummary {
  return {
    schemaVersion: 1,
    goals: [],
    confirmedFacts: [],
    decisions: [],
    unresolvedQuestions: [],
    lastCompactedSequence: 0,
  };
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
