import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const BUSINESS_ROOTS = [
  "app/api/ai",
  "features/war-room",
  "features/auto-review",
];
const FORBIDDEN_IMPORTS = [
  "providers/openai-provider",
  "providers/hunyuan-provider",
];

describe("AI provider business boundary", () => {
  it("keeps real provider adapters behind the gateway layer", () => {
    const violations = BUSINESS_ROOTS.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return FORBIDDEN_IMPORTS.filter((pattern) =>
          source.includes(pattern),
        ).map(
          (pattern) => `${relative(process.cwd(), file)} imports ${pattern}`,
        );
      }),
    );

    expect(violations).toEqual([]);
  });
});

function listTypeScriptFiles(root: string): string[] {
  const absoluteRoot = join(process.cwd(), root);

  try {
    return readdirSync(absoluteRoot).flatMap((entry) => {
      const absolutePath = join(absoluteRoot, entry);
      const stat = statSync(absolutePath);

      if (stat.isDirectory()) {
        return listTypeScriptFiles(join(root, entry));
      }

      return absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx")
        ? [absolutePath]
        : [];
    });
  } catch {
    return [];
  }
}
