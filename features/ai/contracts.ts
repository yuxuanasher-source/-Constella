import type { AuthContext } from "@/lib/auth/context";
import type { AppRole } from "@/lib/rbac/roles";
import type { AiTier } from "./tiers";

export type AiToolScope =
  | "mcn_staff"
  | "streamer"
  | "owner"
  | "ops_manager"
  | "operator_business"
  | "finance";

export type AiToolMasking = {
  input?: string[];
  output?: string[];
  streamerForbiddenKeys?: string[];
};

export type AiToolContext = {
  actor: Pick<AuthContext, "userId" | "name" | "role" | "organizationId">;
  invocationId?: string;
  recordToolInvocation?: (input: AiToolInvocationRecordInput) => Promise<void>;
};

export type AiTool<I, O> = {
  name: string;
  description: string;
  inputSchema: unknown;
  scopes: AiToolScope[];
  masking: AiToolMasking;
  readOnly: true;
  // AI 能力分层（方案第 2 节）。只读工具默认 L1_PERCEIVE；L4_FORBIDDEN 永不注册。
  tier?: AiTier;
  handler(input: I, ctx: AiToolContext): Promise<O> | O;
};

export type AiToolInvocationRecordInput = {
  toolName: string;
  inputSummary: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  scopes: AiToolScope[];
  readOnly: true;
  allowed: boolean;
  status: "succeeded" | "failed" | "denied";
  latencyMs?: number;
  errorSummary?: string;
};

export type AiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type AiCapability = "text" | "structured" | "tools" | "shadow";

export type AiChatMode = "fast" | "deep";

export type AiReasoningConfig = {
  effort: "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
};

export type AiAttachment = {
  name: string;
  mimeType: string;
  sizeBytes?: number;
  text?: string;
  data?: string;
  fileId?: string;
  url?: string;
};

export type AiProviderName =
  | "openai"
  | "hunyuan"
  | "deepseek"
  | "deterministic";

export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AiCostEstimate = {
  costCents: number;
};

export type AiTextInput = {
  promptKey: string;
  promptVersion: number;
  messages: AiMessage[];
  metadata?: Record<string, unknown>;
  mode?: AiChatMode;
  reasoning?: AiReasoningConfig;
  attachments?: AiAttachment[];
};

export type AiStructuredInput = AiTextInput & {
  responseSchema?: unknown;
};

export type AiToolRunInput = AiStructuredInput & {
  tools: Array<AiTool<unknown, unknown>>;
};

export type AiUsageEstimateInput = {
  kind: "text" | "structured" | "tools";
  promptTokens?: number;
  completionTokens?: number;
};

export type AiProviderResult = {
  status: "succeeded" | "failed" | "degraded";
  text?: string;
  structuredOutput?: unknown;
  toolCalls?: unknown[];
  usage: AiUsage;
  latencyMs: number;
  costCents: number;
  rawResponse?: unknown;
  degradedReason?: string;
  errorSummary?: string;
};

export type AiProvider = {
  name: AiProviderName;
  capabilities: AiCapability[];
  runText(input: AiTextInput): Promise<AiProviderResult>;
  runStructured(input: AiStructuredInput): Promise<AiProviderResult>;
  runWithTools(input: AiToolRunInput): Promise<AiProviderResult>;
  estimateCost(input: AiUsageEstimateInput): AiCostEstimate;
};

export type AiGatewayRequest =
  | ({ kind: "text" } & AiTextInput)
  | ({ kind: "structured" } & AiStructuredInput)
  | ({ kind: "tools" } & AiToolRunInput);

export type AiGatewayResult = AiProviderResult & {
  providerName?: AiProviderName;
  fallbackUsed: boolean;
};

export type AgentOutput = {
  facts: Array<{
    statement: string;
    sourceTool: string;
    sourceId: string;
  }>;
  findings: Array<{
    summary: string;
    evidence: Array<{ sourceTool: string; sourceId: string }>;
  }>;
  caveats: Array<{
    summary: string;
    unverifiedExternalFactor: boolean;
  }>;
  recommendations: Array<{
    proposal: string;
    expectedImpact?: string;
    requiresHumanApproval: true;
  }>;
};

export type AiInvocationStatus =
  | "started"
  | "queued"
  | "succeeded"
  | "failed"
  | "degraded";

export type AiActor = Pick<
  AuthContext,
  "userId" | "name" | "role" | "organizationId"
>;

export type AiExecutionActor =
  | (AiActor & { actorKind?: "human"; workerId?: never })
  | {
      actorKind: "system";
      userId?: undefined;
      name: string;
      role: "ops_manager";
      organizationId: string;
      workerId: string;
    };

export function scopeAllowsRole(scope: AiToolScope, role: AppRole): boolean {
  if (scope === "mcn_staff") {
    return (
      role === "owner" ||
      role === "ops_manager" ||
      role === "operator_business" ||
      role === "finance"
    );
  }
  return scope === role;
}
