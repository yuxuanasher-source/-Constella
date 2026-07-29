import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".worktrees/**",
    ".agents/**",
    ".claude/**",
    ".claude/worktrees/**",
    ".codex/**",
    ".codex-*/**",
    ".docker-codex/**",
    ".github/skills/**",
    ".hermes-test/**",
    ".impeccable/**",
    ".obsidian/**",
    ".pnpm-store/**",
    ".pytest-*/**",
    ".pycache-*/**",
    ".qa-screenshots/**",
    ".superpowers/**",
    ".test-cache/**",
    ".test-tmp/**",
    ".tmp/**",
    ".tmp_pytest_invocation/**",
    ".vercel/**",
    "outputs/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
