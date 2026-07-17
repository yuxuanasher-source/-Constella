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
  },
});
