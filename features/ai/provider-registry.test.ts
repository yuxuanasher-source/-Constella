import { describe, expect, it } from "vitest";

import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "./provider-registry";

describe("provider registry", () => {
  it("returns deterministic provider only when no real provider is configured", () => {
    const providers = createConfiguredAiProviders({ env: {} });

    expect(providers.map((provider) => provider.name)).toEqual([
      "deterministic",
    ]);
  });

  it("orders real providers before deterministic when credentials exist", () => {
    const providers = createConfiguredAiProviders({
      env: {
        OPENAI_API_KEY: "openai-key",
        HUNYUAN_API_KEY: "hunyuan-key",
        HUNYUAN_BASE_URL: "https://api.hunyuan.cloud.tencent.com",
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      "openai",
      "hunyuan",
      "deepseek",
      "deterministic",
    ]);
  });

  it("registers DeepSeek with only an API key because base/model have defaults", () => {
    const providers = createConfiguredAiProviders({
      env: {
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      "deepseek",
      "deterministic",
    ]);
  });

  it("resolves valid primary and shadow provider names from env", () => {
    expect(
      resolveAiProviderRouting({
        AI_PRIMARY_PROVIDER: "deepseek",
        AI_SHADOW_PROVIDER: "hunyuan",
      }),
    ).toEqual({ primaryProvider: "deepseek", shadowProvider: "hunyuan" });
  });

  it("ignores unknown provider routing env values", () => {
    expect(
      resolveAiProviderRouting({
        AI_PRIMARY_PROVIDER: "unknown",
        AI_SHADOW_PROVIDER: "other",
      }),
    ).toEqual({});
  });
});
