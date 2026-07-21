import {
  HERMES_PROFILE_VERSION,
  isHermesActorProfile,
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
import {
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
  clientRequest: unknown;
  enabledSkillVersions?: HermesSkillGrant[];
};

export type NativeAssistantContext = NativeAssistantClientRequest & {
  assistant: typeof NATIVE_XINGYAO_ASSISTANT;
  actor: HermesActorProfile;
  skillAudit: HermesSkillGrantAuditEvent;
};

export function buildNativeAssistantContext(
  input: BuildContextInput,
): NativeAssistantContext | null {
  const clientRequest = parseNativeAssistantClientRequest(input.clientRequest);
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
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: clientRequest.pageContext ?? { pageType: "global", objectIds: [] },
  };

  if (!isHermesActorProfile(actor)) {
    return null;
  }

  return {
    assistant: NATIVE_XINGYAO_ASSISTANT,
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

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
