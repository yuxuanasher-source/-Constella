import {
  HERMES_PROFILE_VERSION,
  isHermesActorProfile,
  isUuid,
  type HermesActorProfile,
} from "../hermes/contracts";
import { getAllowedReadScopesForRole } from "../hermes/read-scopes";
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
  clientRequest: unknown;
  skillGrantsHash: string;
};

export type NativeAssistantContext = NativeAssistantClientRequest & {
  assistant: typeof NATIVE_XINGYAO_ASSISTANT;
  actor: HermesActorProfile;
};

export function buildNativeAssistantContext(
  input: BuildContextInput,
): NativeAssistantContext | null {
  const clientRequest = parseNativeAssistantClientRequest(input.clientRequest);
  const allowedReadScopes = getAllowedReadScopesForRole(input.auth.role);
  if (
    !clientRequest ||
    allowedReadScopes.length === 0 ||
    !isUuid(input.auth.userId) ||
    !isUuid(input.auth.organizationId) ||
    !isUuid(input.conversationId)
  ) {
    return null;
  }

  const actor = {
    userId: input.auth.userId,
    organizationId: input.auth.organizationId,
    role: input.auth.role,
    conversationId: input.conversationId,
    allowedReadScopes,
    skillGrantsHash: input.skillGrantsHash,
    profileVersion: HERMES_PROFILE_VERSION,
  };

  if (!isHermesActorProfile(actor)) {
    return null;
  }

  return {
    assistant: NATIVE_XINGYAO_ASSISTANT,
    ...clientRequest,
    actor,
  };
}
