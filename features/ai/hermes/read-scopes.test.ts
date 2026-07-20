import { describe, expect, it } from "vitest";

import { HERMES_READ_SCOPES, getAllowedReadScopesForRole } from "./read-scopes";

describe("Hermes read scope baseline", () => {
  it("defines the exact read scope universe", () => {
    expect(HERMES_READ_SCOPES).toEqual([
      "context.read",
      "projects.search",
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
      "settlements.summary",
    ]);
  });

  it("covers all product roles and fails closed for unknown roles", () => {
    expect(getAllowedReadScopesForRole("owner")).toEqual(HERMES_READ_SCOPES);
    expect(getAllowedReadScopesForRole("ops_manager")).toEqual(
      HERMES_READ_SCOPES,
    );
    expect(getAllowedReadScopesForRole("operator_business")).toEqual([
      "context.read",
      "projects.search",
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
    ]);
    expect(getAllowedReadScopesForRole("finance")).toEqual([
      "context.read",
      "projects.search",
      "projects.summary",
      "knowledge.search",
      "settlements.summary",
    ]);
    expect(getAllowedReadScopesForRole("streamer")).toEqual(HERMES_READ_SCOPES);
    expect(getAllowedReadScopesForRole("admin")).toEqual([]);
  });
});
