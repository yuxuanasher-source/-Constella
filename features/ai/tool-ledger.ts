import type { AiActor, AiToolInvocationRecordInput } from "./contracts";

type AiToolLedgerClient = {
  from(table: "ai_tool_invocations"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

export async function recordAiToolInvocation({
  client,
  actor,
  invocationId,
  input,
}: {
  client: AiToolLedgerClient;
  actor: AiActor;
  invocationId: string;
  input: AiToolInvocationRecordInput;
}): Promise<void> {
  const { error } = await client.from("ai_tool_invocations").insert({
    organization_id: actor.organizationId,
    ai_invocation_id: invocationId,
    tool_name: input.toolName,
    input_summary: input.inputSummary,
    output_summary: input.outputSummary ?? {},
    scopes: input.scopes,
    read_only: input.readOnly,
    allowed: input.allowed,
    status: input.status,
    latency_ms:
      input.latencyMs === undefined
        ? undefined
        : nonnegativeInt(input.latencyMs),
    error_summary: input.errorSummary,
    completed_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

function nonnegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
