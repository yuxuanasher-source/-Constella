import type { AiProvider, AiProviderName } from "./contracts";
import { createDeepseekProvider } from "./providers/deepseek-provider";
import { createDeterministicProvider } from "./providers/deterministic-provider";
import { createHunyuanProvider } from "./providers/hunyuan-provider";
import { createOpenAiProvider } from "./providers/openai-provider";

type AiProviderEnv = Record<string, string | undefined>;

export function createConfiguredAiProviders({
  env = process.env,
}: {
  env?: AiProviderEnv;
} = {}): AiProvider[] {
  const providers: AiProvider[] = [];

  if (env.OPENAI_API_KEY?.trim()) {
    providers.push(
      createOpenAiProvider({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
      }),
    );
  }

  if (env.HUNYUAN_API_KEY?.trim() && env.HUNYUAN_BASE_URL?.trim()) {
    providers.push(
      createHunyuanProvider({
        apiKey: env.HUNYUAN_API_KEY,
        baseUrl: env.HUNYUAN_BASE_URL,
        model: env.HUNYUAN_MODEL,
      }),
    );
  }

  // DeepSeek（OpenAI 兼容）：base/model 有默认值，只需 DEEPSEEK_API_KEY。
  if (env.DEEPSEEK_API_KEY?.trim()) {
    providers.push(
      createDeepseekProvider({
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL,
        model: env.DEEPSEEK_MODEL,
      }),
    );
  }

  providers.push(createDeterministicProvider());

  return providers;
}

export function resolveAiProviderRouting(env: AiProviderEnv = process.env): {
  primaryProvider?: AiProviderName;
  shadowProvider?: AiProviderName;
} {
  const primaryProvider = parseProviderName(env.AI_PRIMARY_PROVIDER);
  const shadowProvider = parseProviderName(env.AI_SHADOW_PROVIDER);

  return {
    ...(primaryProvider ? { primaryProvider } : {}),
    ...(shadowProvider ? { shadowProvider } : {}),
  };
}

function parseProviderName(
  value: string | undefined,
): AiProviderName | undefined {
  if (
    value === "openai" ||
    value === "hunyuan" ||
    value === "deepseek" ||
    value === "deterministic"
  ) {
    return value;
  }
  return undefined;
}
