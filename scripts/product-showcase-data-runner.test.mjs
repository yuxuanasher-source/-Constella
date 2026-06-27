import { describe, expect, it } from "vitest";

import {
  createProductShowcaseRunner,
  createStableUuidFactory,
} from "./product-showcase-data-fixture.mjs";

describe("product showcase runner", () => {
  it("loads rows for the account active organization and verifies the result", async () => {
    const adapter = createFakeAdapter();
    const runner = createProductShowcaseRunner(adapter);

    const summary = await runner.load({ account: "OWNER@example.cn" });

    expect(summary).toMatchObject({
      organizationId: adapter.organization.id,
      targetAccountId: adapter.account.id,
      projects: 2,
      streamers: 3,
      liveTasks: 5,
      liveReports: 4,
    });
    expect(adapter.calls.map((call) => call[0])).toEqual([
      "resolveTargetAccount",
      "resolveTargetOrganization",
      "clearRows",
      "insertRows",
      "summarize",
    ]);
    expect(adapter.insertedRows.streamers[0].user_id).toBe(adapter.account.id);
  });

  it("clears only the deterministic rows for the target account and organization", async () => {
    const adapter = createFakeAdapter();
    const runner = createProductShowcaseRunner(adapter);

    await runner.clear({ account: "owner@example.cn" });

    expect(adapter.calls.map((call) => call[0])).toEqual([
      "resolveTargetAccount",
      "resolveTargetOrganization",
      "clearRows",
      "summarize",
    ]);
    expect(adapter.clearedManifest.projectIds).toEqual(
      expect.arrayContaining([
        createStableUuidFactory(
          adapter.account.id,
          adapter.organization.id,
        )("project-live-growth"),
      ]),
    );
  });
});

function createFakeAdapter() {
  const calls = [];
  const account = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.cn",
    full_name: "Product Owner",
  };
  const organization = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Existing MCN",
    code: "existing-mcn",
  };
  const adapter = {
    calls,
    account,
    organization,
    insertedRows: null,
    clearedManifest: null,
    async resolveTargetAccount(accountInput) {
      calls.push(["resolveTargetAccount", accountInput]);
      return account;
    },
    async resolveTargetOrganization(targetAccount, options) {
      calls.push(["resolveTargetOrganization", targetAccount.id, options]);
      return organization;
    },
    async clearRows(manifest) {
      calls.push(["clearRows", manifest.organizationId]);
      adapter.clearedManifest = manifest;
    },
    async insertRows(rows) {
      calls.push(["insertRows", rows.projects.length]);
      adapter.insertedRows = rows;
    },
    async summarize(manifest) {
      calls.push(["summarize", manifest.organizationId]);
      return {
        organizationId: manifest.organizationId,
        targetAccountId: account.id,
        projects: manifest.projectIds.length,
        streamers: manifest.streamerIds.length,
        liveTasks: manifest.liveTaskIds.length,
        liveReports: manifest.liveReportIds.length,
      };
    },
  };
  return adapter;
}
