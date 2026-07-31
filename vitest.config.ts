import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "**/.claude/worktrees/**",
      "**/.worktrees/**",
      "tests/visual/**",
    ],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage/critical",
      reporter: ["text", "json-summary"],
      include: [
        "lib/markdown/**",
        "features/billing/providers/**",
        "features/billing/webhooks.ts",
        "features/billing/usage-metering.ts",
        "features/ai/knowledge-base.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 75,
      },
    },
  },
});
