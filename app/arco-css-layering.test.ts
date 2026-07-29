import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(process.cwd(), "app");

describe("Arco CSS cascade layering", () => {
  it("loads Arco styles in a lower-priority cascade layer than Tailwind utilities", () => {
    const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");
    const globals = readFileSync(join(appDir, "globals.css"), "utf8");

    expect(layout).not.toContain("@arco-design/web-react/dist/css/arco.css");
    expect(globals).toContain(
      '@import "@arco-design/web-react/dist/css/arco.css" layer(arco);',
    );
    expect(globals.indexOf("layer(arco)")).toBeLessThan(
      globals.indexOf('@import "tailwindcss"'),
    );
  });
});
