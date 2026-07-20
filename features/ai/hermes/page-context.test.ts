import { describe, expect, it } from "vitest";

import {
  HERMES_PAGE_TYPES,
  HermesPageContextError,
  hasClientControlledActorFields,
  sanitizeHermesPageContext,
} from "./page-context";

const OBJECT_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_OBJECT_ID = "77777777-7777-4777-8777-777777777777";

describe("Hermes page context", () => {
  it("accepts only the fixed v1 page types", () => {
    expect(HERMES_PAGE_TYPES).toEqual([
      "dashboard",
      "projects",
      "project",
      "streamer_profile",
      "live_reports",
      "recording_reviews",
      "knowledge",
      "settlements",
    ]);

    for (const pageType of HERMES_PAGE_TYPES) {
      expect(sanitizeHermesPageContext({ pageType, objectIds: [] })).toEqual({
        pageType,
        objectIds: [],
      });
    }
    expect(() =>
      sanitizeHermesPageContext({ pageType: "admin", objectIds: [] }),
    ).toThrow(HermesPageContextError);
  });

  it("sorts and deeply freezes at most 20 canonical UUID hints", () => {
    const context = sanitizeHermesPageContext({
      pageType: "project",
      objectIds: [SECOND_OBJECT_ID, OBJECT_ID],
    });

    expect(context.objectIds).toEqual([OBJECT_ID, SECOND_OBJECT_ID]);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.objectIds)).toBe(true);

    const tooManyIds = Array.from(
      { length: 21 },
      (_, index) =>
        `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );
    expect(() =>
      sanitizeHermesPageContext({
        pageType: "projects",
        objectIds: tooManyIds,
      }),
    ).toThrow(HermesPageContextError);
    expect(() =>
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: [OBJECT_ID, OBJECT_ID],
      }),
    ).toThrow(HermesPageContextError);
    expect(() =>
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: ["not-a-uuid"],
      }),
    ).toThrow(HermesPageContextError);
  });

  it.each([
    "organizationId",
    "organization_id",
    "userId",
    "role",
    "allowedReadScopes",
    "allowed-read-scopes",
    "enabledSkillVersions",
    "skillGrantsHash",
    "actorFingerprint",
  ])("detects client-controlled actor field %s", (field) => {
    expect(
      hasClientControlledActorFields({
        pageType: "project",
        objectIds: [],
        nested: { [field]: "attacker-value" },
      }),
    ).toBe(true);
  });

  it("rejects actor fields without reflecting attacker values", () => {
    const attackerValue = "secret-attacker-organization";

    expect(() =>
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: [],
        organizationId: attackerValue,
      }),
    ).toThrowError(HermesPageContextError);
    try {
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: [],
        organizationId: attackerValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(attackerValue);
    }
  });
});
