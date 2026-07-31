import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = join(
  process.cwd(),
  ".github/workflows/stale-usage-reservations.yml",
);
const workflow = existsSync(workflowPath)
  ? readFileSync(workflowPath, "utf8")
  : "";

describe("stale usage reservation workflow contract", () => {
  it("runs daily on a bounded hosted runner with least privilege", () => {
    expect(workflow).not.toBe("");
    expect(workflow).toContain('cron: "17 3 * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("\t");
  });

  it("fails closed on URL, secret, timeout, and non-2xx without printing the body", () => {
    expect(workflow).toContain("APP_BASE_URL: ${{ vars.APP_BASE_URL }}");
    expect(workflow).toContain(
      "BILLING_CRON_SECRET: ${{ secrets.BILLING_CRON_SECRET }}",
    );
    expect(workflow).toContain('if [[ ! "$APP_BASE_URL" =~ ^https://');
    expect(workflow).toContain('if [[ -z "$BILLING_CRON_SECRET" ]]');
    expect(workflow).toContain('response_file="$(mktemp)"');
    expect(workflow).toContain("trap 'rm -f \"$response_file\"' EXIT");
    expect(workflow).toContain("--connect-timeout 10");
    expect(workflow).toContain("--max-time 240");
    expect(workflow).toContain('--output "$response_file"');
    expect(workflow).toContain(
      "/api/billing/jobs/stale-usage-reservations",
    );
    expect(workflow).toContain(
      '--header "x-cron-secret: ${BILLING_CRON_SECRET}"',
    );
    expect(workflow).toContain('if [[ ! "$status" =~ ^2[0-9]{2}$ ]]');
    expect(workflow).not.toMatch(/\bcat\s+[^\n]*response_file/u);
    expect(workflow).not.toMatch(/\becho\s+[^\n]*response_file/u);
  });
});
