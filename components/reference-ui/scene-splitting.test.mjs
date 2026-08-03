import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const referenceSource = fs.readFileSync(
  path.join(currentDirectory, "ops-reference.jsx"),
  "utf8",
);

describe("OpsReferenceApp scene splitting", () => {
  it("keeps AdmissionShareCenter in the admission lazy chunk and injects it during configuration", () => {
    const admissionLoader = referenceSource.slice(
      referenceSource.indexOf("const ScreenAdmission = lazy"),
      referenceSource.indexOf("const ScreenSettlement = lazy"),
    );
    const admissionDependencies = referenceSource.slice(
      referenceSource.indexOf("const ADMISSION_SCENE_DEPENDENCIES = {"),
      referenceSource.indexOf(
        "\n};",
        referenceSource.indexOf("const ADMISSION_SCENE_DEPENDENCIES = {"),
      ),
    );

    expect(referenceSource).not.toMatch(
      /import\s*\{\s*AdmissionShareCenter\s*\}\s*from\s*["']\.\/admission-share-center["']/,
    );
    expect(admissionLoader).toContain('import("./admission-share-center")');
    expect(admissionLoader).toMatch(
      /configureAdmissionScene\(\s*\{[\s\S]*\.\.\.ADMISSION_SCENE_DEPENDENCIES,[\s\S]*AdmissionShareCenter:\s*\w+\.AdmissionShareCenter[\s\S]*\}\s*\)/,
    );
    expect(admissionDependencies).not.toMatch(/\bAdmissionShareCenter\b/);
  });

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

      expect(referenceSource).toContain(`import("./scenes/${route}-scene")`);
      expect(referenceSource).toContain(
        `scene.configure${exportName.replace("Screen", "")}Scene(`,
      );
      expect(referenceSource).toContain(`aria-label="${fallback}"`);
      expect(referenceSource).not.toContain(`function ${exportName}`);
      expect(sceneSource).toContain(`export default function ${exportName}`);
    },
  );

  it.each([
    {
      configureName: "configureAdmissionScene",
      file: "./scenes/admission-scene.jsx",
    },
    {
      configureName: "configureSettlementScene",
      file: "./scenes/settlement-scene.jsx",
    },
  ])(
    "configures $configureName once and rejects an inconsistent rebind",
    async ({ configureName, file }) => {
      vi.resetModules();
      const scene =
        file === "./scenes/admission-scene.jsx"
          ? await import("./scenes/admission-scene.jsx")
          : await import("./scenes/settlement-scene.jsx");
      const dependencies = Object.freeze({});

      expect(() => scene[configureName](dependencies)).not.toThrow();
      expect(() => scene[configureName](dependencies)).not.toThrow();
      expect(() => scene[configureName]({})).toThrow(/cannot be reconfigured/);
    },
  );
});
