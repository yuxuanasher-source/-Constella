import type {
  AiCapability,
  AiGatewayRequest,
  AiGatewayResult,
  AiProvider,
  AiProviderName,
  AiProviderResult,
} from "./contracts";

export async function runAiGateway({
  providers,
  primaryProvider,
  request,
}: {
  providers: AiProvider[];
  primaryProvider?: AiProviderName;
  request: AiGatewayRequest;
}): Promise<AiGatewayResult> {
  const capability = capabilityForRequest(request.kind);
  const candidates = orderProviders(
    providers.filter((provider) => provider.capabilities.includes(capability)),
    primaryProvider,
  );

  if (!candidates.length) {
    return degraded("provider_unconfigured");
  }

  const failures: string[] = [];

  for (const [index, provider] of candidates.entries()) {
    try {
      const providerResult = await runProvider(provider, request);
      if (providerResult.status === "failed") {
        failures.push(providerResult.errorSummary ?? `${provider.name} failed`);
        continue;
      }

      if (request.kind === "structured") {
        const validation = validateStructuredOutput(
          request.responseSchema,
          providerResult.structuredOutput,
        );
        if (!validation.valid) {
          failures.push(
            `${provider.name} schema validation failed: ${validation.errorSummary}`,
          );
          continue;
        }
      }

      return {
        ...providerResult,
        providerName: provider.name,
        fallbackUsed: index > 0,
        degradedReason:
          index > 0 ? "primary_failed" : providerResult.degradedReason,
      };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "provider failed");
    }
  }

  return {
    status: "failed",
    providerName: candidates[0]?.name,
    fallbackUsed: candidates.length > 1,
    degradedReason: "all_providers_failed",
    errorSummary: failures.join("; "),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    latencyMs: 0,
    costCents: 0,
  };
}

function capabilityForRequest(kind: AiGatewayRequest["kind"]): AiCapability {
  if (kind === "tools") {
    return "tools";
  }
  return kind;
}

// 也被 llm-gateway-stream.ts 复用，保证流式/非流式的 provider 优先级一致。
export function orderProviders(
  providers: AiProvider[],
  primaryProvider?: AiProviderName,
): AiProvider[] {
  if (!primaryProvider) {
    return providers;
  }

  return [
    ...providers.filter((provider) => provider.name === primaryProvider),
    ...providers.filter((provider) => provider.name !== primaryProvider),
  ];
}

async function runProvider(
  provider: AiProvider,
  request: AiGatewayRequest,
): Promise<AiProviderResult> {
  if (request.kind === "text") {
    return provider.runText(request);
  }
  if (request.kind === "structured") {
    return provider.runStructured(request);
  }
  return provider.runWithTools(request);
}

function degraded(reason: string): AiGatewayResult {
  return {
    status: "degraded",
    fallbackUsed: false,
    degradedReason: reason,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    latencyMs: 0,
    costCents: 0,
  };
}

function validateStructuredOutput(
  schema: unknown,
  output: unknown,
): { valid: true } | { valid: false; errorSummary: string } {
  if (!schema) {
    return { valid: true };
  }

  const maybeSafeParse = schema as {
    safeParse?: (value: unknown) => { success: boolean; error?: unknown };
    parse?: (value: unknown) => unknown;
  };

  if (typeof maybeSafeParse.safeParse === "function") {
    const result = maybeSafeParse.safeParse(output);
    return result.success
      ? { valid: true }
      : {
          valid: false,
          errorSummary: "Structured output did not match schema",
        };
  }

  if (typeof maybeSafeParse.parse === "function") {
    try {
      maybeSafeParse.parse(output);
      return { valid: true };
    } catch {
      return {
        valid: false,
        errorSummary: "Structured output did not match schema",
      };
    }
  }

  return { valid: true };
}
