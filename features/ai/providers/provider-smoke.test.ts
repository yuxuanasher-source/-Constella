import { describe, expect, it } from "vitest";

import { runAiGateway } from "../llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "../provider-registry";

describe("env-gated LLM provider smoke tests", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)(
    "calls OpenAI through runAiGateway when OPENAI_API_KEY is configured",
    async () => {
      const result = await runAiGateway({
        providers: createConfiguredAiProviders({
          env: {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            OPENAI_MODEL: process.env.OPENAI_MODEL,
            AI_PRIMARY_PROVIDER: "openai",
          },
        }),
        primaryProvider: "openai",
        request: {
          kind: "text",
          promptKey: "smoke.openai",
          promptVersion: 1,
          messages: [{ role: "user", content: "Reply with OK." }],
        },
      });

      expect(result.providerName).toBe("openai");
      expect(result.status).toBe("succeeded");
      expect(result.text?.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!process.env.HUNYUAN_API_KEY || !process.env.HUNYUAN_BASE_URL)(
    "calls Hunyuan through runAiGateway when Hunyuan env is configured",
    async () => {
      const routing = resolveAiProviderRouting({
        AI_PRIMARY_PROVIDER: "hunyuan",
      });
      const result = await runAiGateway({
        providers: createConfiguredAiProviders({
          env: {
            HUNYUAN_API_KEY: process.env.HUNYUAN_API_KEY,
            HUNYUAN_BASE_URL: process.env.HUNYUAN_BASE_URL,
            HUNYUAN_MODEL: process.env.HUNYUAN_MODEL,
          },
        }),
        primaryProvider: routing.primaryProvider,
        request: {
          kind: "text",
          promptKey: "smoke.hunyuan",
          promptVersion: 1,
          messages: [{ role: "user", content: "Reply with OK." }],
        },
      });

      expect(result.providerName).toBe("hunyuan");
      expect(result.status).toBe("succeeded");
      expect(result.text?.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!process.env.DEEPSEEK_API_KEY)(
    "calls DeepSeek through runAiGateway when DEEPSEEK_API_KEY is configured",
    async () => {
      const routing = resolveAiProviderRouting({
        AI_PRIMARY_PROVIDER: "deepseek",
      });
      const result = await runAiGateway({
        providers: createConfiguredAiProviders({
          env: {
            DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
            DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
            DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
          },
        }),
        primaryProvider: routing.primaryProvider,
        request: {
          kind: "text",
          promptKey: "smoke.deepseek",
          promptVersion: 1,
          messages: [{ role: "user", content: "请回复 OK。" }],
        },
      });

      expect(result.providerName).toBe("deepseek");
      expect(result.status).toBe("succeeded");
      expect(result.text?.length).toBeGreaterThan(0);
    },
  );
});
