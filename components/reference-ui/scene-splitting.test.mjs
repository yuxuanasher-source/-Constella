import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const referenceSource = fs.readFileSync(
  path.join(currentDirectory, "ops-reference.jsx"),
  "utf8",
);

describe("OpsReferenceApp scene splitting", () => {
  it("loads the knowledge base through a dedicated lazy scene and stable fallback", () => {
    const knowledgeSceneSource = fs.readFileSync(
      path.join(currentDirectory, "scenes", "knowledge-base-scene.jsx"),
      "utf8",
    );

    expect(referenceSource).toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\("\.\/scenes\/knowledge-base-scene"\),?\s*\)/,
    );
    expect(referenceSource).toContain('aria-label="知识库加载中"');
    expect(referenceSource).not.toContain("function ScreenKnowledge()");
    expect(knowledgeSceneSource).toContain(
      "export default function ScreenKnowledge",
    );
  });

  it.each([
    {
      exportName: "ScreenAdmission",
      fallback: "准入审核加载中",
      file: "admission-scene.jsx",
      route: "admission",
    },
    {
      exportName: "ScreenSettlement",
      fallback: "结算中心加载中",
      file: "settlement-scene.jsx",
      route: "settlement",
    },
  ])(
    "loads $route through a dedicated lazy scene and stable fallback",
    ({ exportName, fallback, file, route }) => {
      const sceneSource = fs.readFileSync(
        path.join(currentDirectory, "scenes", file),
        "utf8",
      );

      expect(referenceSource).toContain(
        `lazy(() => import("./scenes/${route}-scene"))`,
      );
      expect(referenceSource).toContain(`aria-label="${fallback}"`);
      expect(referenceSource).not.toContain(`function ${exportName}`);
      expect(sceneSource).toContain(`export default function ${exportName}`);
    },
  );
});
