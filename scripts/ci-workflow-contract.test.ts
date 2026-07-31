import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import prettier from "prettier";

const repoFile = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const extractJob = (workflow: string, jobName: string): string => {
  const lines = workflow.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => line === "jobs:");
  expect(jobsLine).toBeGreaterThanOrEqual(0);

  const jobLine = lines.findIndex(
    (line, index) => index > jobsLine && line === `  ${jobName}:`,
  );
  expect(jobLine).toBeGreaterThan(jobsLine);

  const nextJobLine = lines.findIndex(
    (line, index) => index > jobLine && /^  [a-z0-9][a-z0-9-]*:$/.test(line),
  );

  return lines
    .slice(jobLine, nextJobLine === -1 ? undefined : nextJobLine)
    .join("\n");
};

const ciWorkflow = repoFile(".github/workflows/ci.yml");
const scheduledWorkflow = repoFile(".github/workflows/scheduled-runners.yml");

describe("CI workflow contracts", () => {
  it("runs pull requests and default-branch pushes without double-running feature pushes", () => {
    expect(ciWorkflow).toContain(
      "on:\n  pull_request:\n  push:\n    branches:\n      - codex/full-project-ui",
    );
  });

  it("uses least privilege and cancels superseded branch runs", () => {
    expect(ciWorkflow).toContain("permissions:\n  contents: read");
    expect(ciWorkflow).toContain(
      "concurrency:\n  group: ci-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true",
    );
  });

  it.each(["verify", "database-regression"])(
    "runs %s on a hosted Ubuntu runner with a 30 minute timeout",
    (jobName) => {
      const job = extractJob(ciWorkflow, jobName);
      expect(job).toContain("runs-on: ubuntu-latest");
      expect(job).toContain("timeout-minutes: 30");
      expect(job).not.toContain("self-hosted");
    },
  );

  it("keeps the Docker-backed Supabase database lifecycle on the hosted runner", () => {
    const job = extractJob(ciWorkflow, "database-regression");
    expect(job).toContain("run: pnpm supabase:start");
    expect(job).toContain("run: docker stop supabase_realtime_jingying-cabin");
    expect(job).toContain("run: pnpm supabase:migrate");
    expect(job).toContain("run: docker start supabase_realtime_jingying-cabin");
    expect(job).toContain("run: pnpm exec supabase stop --no-backup");
  });

  it("pins every third-party action to its verified immutable commit", () => {
    const expectedPins = new Map([
      ["actions/checkout", "11d5960a326750d5838078e36cf38b85af677262"],
      ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
      ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
      ["pnpm/action-setup", "b906affcce14559ad1aafd4ab0e942779e9f58b1"],
    ]);
    const usages = [
      ...ciWorkflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)\s+# v4/g),
    ];

    expect(usages).toHaveLength(7);
    for (const [, action, revision] of usages) {
      expect(expectedPins.has(action)).toBe(true);
      expect(revision).toMatch(/^[0-9a-f]{40}$/);
      expect(revision).toBe(expectedPins.get(action));
    }
    expect(ciWorkflow).not.toMatch(/uses:\s+[^@\s]+@v\d/);
  });

  it("does not persist checkout credentials in either hosted job", () => {
    expect(
      ciWorkflow.match(
        /uses:\s+actions\/checkout@[0-9a-f]{40}\s+# v4\s+with:\s+persist-credentials:\s+false/g,
      ),
    ).toHaveLength(2);
  });

  it("publishes only a default-branch artifact that survives a full runtime round trip", () => {
    const defaultBranchArtifactGuard =
      "if: github.event_name == 'push' && github.ref == 'refs/heads/codex/full-project-ui'";

    expect(
      ciWorkflow.match(
        new RegExp(
          defaultBranchArtifactGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g",
        ),
      ),
    ).toHaveLength(3);
    expect(ciWorkflow).toContain(
      "- name: Verify reviewed release artifact round trip",
    );
    expect(ciWorkflow).toContain(
      'node "$candidate/scripts/extract-release-artifact.mjs"',
    );
    expect(ciWorkflow).toContain(
      'node "$candidate/scripts/release-integrity.mjs" verify',
    );
    expect(ciWorkflow).toContain('.listen(54321, "127.0.0.1")');
    expect(ciWorkflow).toContain(
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
    );
    expect(ciWorkflow).toContain("XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED=true");
    expect(ciWorkflow).toContain("node .next/standalone/server.js");
    expect(ciWorkflow).toContain("http://127.0.0.1:3999/api/health");
    expect(ciWorkflow).toContain("- name: Upload reviewed release artifact");
  });
});

describe("scheduled runner workflow contracts", () => {
  const scheduledJobs = [
    "ocr-runner",
    "recording-ai-runner",
    "recording-intelligence-learn",
    "anomaly-runner",
    "account-metrics-sync-runner",
    "account-idle-scan-runner",
  ];

  it("keeps the workflow token read-only", () => {
    expect(scheduledWorkflow).toContain("permissions:\n  contents: read");
  });

  it.each(scheduledJobs)(
    "runs %s on hosted Ubuntu with bounded, body-safe HTTP logging",
    (jobName) => {
      const job = extractJob(scheduledWorkflow, jobName);
      expect(job).toContain("runs-on: ubuntu-latest");
      expect(job).toContain("timeout-minutes: 5");
      expect(job).toContain(
        `concurrency:\n      group: scheduled-${jobName}\n      cancel-in-progress: false`,
      );
      expect(job).not.toContain("self-hosted");
      expect(job).toContain('response_file="$(mktemp)"');
      expect(job).toContain("trap 'rm -f \"$response_file\"' EXIT");
      expect(job).toContain("--connect-timeout 10");
      expect(job).toContain("--max-time 240");
      expect(job).toContain('-o "$response_file"');
      expect(job).toContain('[ "$status" -lt 200 ] || [ "$status" -ge 300 ]');
      expect(job).toContain("completed with HTTP $status");
      expect(job).not.toMatch(/\bcat\s+["']?response/);
      expect(job).not.toContain("set -x");
    },
  );

  it.each(scheduledJobs)(
    "rejects non-HTTPS APP_BASE_URL before %s sends its bearer token",
    (jobName) => {
      const job = extractJob(scheduledWorkflow, jobName);
      const schemeGuard = job.indexOf('case "$APP_BASE_URL" in');
      const request = job.indexOf("status=$(curl");

      expect(schemeGuard).toBeGreaterThanOrEqual(0);
      expect(job).toContain("https://?*) ;;");
      expect(job).toContain(
        'echo "Runner request blocked: APP_BASE_URL must use HTTPS" >&2',
      );
      expect(request).toBeGreaterThan(schemeGuard);
      expect(job).toContain("--proto '=https'");
      expect(job).not.toContain('echo "$APP_BASE_URL"');
    },
  );
});

describe("repository governance contracts", () => {
  it("assigns the verified repository administrator to sensitive paths", () => {
    const codeowners = repoFile(".github/CODEOWNERS");
    expect(codeowners).toContain("* @yuxuanasher-source");
    expect(codeowners).toContain("/.github/ @yuxuanasher-source");
    expect(codeowners).toContain("/features/billing/ @yuxuanasher-source");
    expect(codeowners).toContain("/app/api/billing/ @yuxuanasher-source");
    expect(codeowners).toContain("/supabase/migrations/ @yuxuanasher-source");
    expect(codeowners).toContain("/scripts/deploy.sh @yuxuanasher-source");
  });

  it.each(["npm", "github-actions"])(
    "configures weekly %s updates with a five-PR cap",
    (ecosystem) => {
      const dependabot = repoFile(".github/dependabot.yml");
      const entry = dependabot
        .split(/(?=  - package-ecosystem:)/)
        .find((part) => part.includes(`package-ecosystem: "${ecosystem}"`));

      expect(entry).toBeDefined();
      expect(entry).toContain('directory: "/"');
      expect(entry).toContain('interval: "weekly"');
      expect(entry).toContain("open-pull-requests-limit: 5");
    },
  );
});

describe("workflow YAML syntax", () => {
  it.each([
    ".github/workflows/ci.yml",
    ".github/workflows/scheduled-runners.yml",
    ".github/dependabot.yml",
  ])("parses %s as YAML", async (relativePath) => {
    await expect(
      prettier.format(repoFile(relativePath), { parser: "yaml" }),
    ).resolves.toEqual(expect.any(String));
  });
});
