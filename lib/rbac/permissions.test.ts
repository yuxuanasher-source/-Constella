import { describe, expect, it } from "vitest";

import {
  canCreateOrganizationMemberRole,
  canCreateProjectDraft,
  canManageOrganizationMembers,
  canPublishProject,
  canViewOrganizationMembers,
  getCreatableOrganizationMemberRoles,
} from "./permissions";

describe("project permissions", () => {
  it("allows operator_business to create drafts but not publish", () => {
    expect(canCreateProjectDraft("operator_business")).toBe(true);
    expect(canPublishProject("operator_business")).toBe(false);
  });

  it("allows owner and ops_manager to publish projects", () => {
    expect(canPublishProject("owner")).toBe(true);
    expect(canPublishProject("ops_manager")).toBe(true);
  });
});

describe("organization member permissions", () => {
  it("allows owner and ops_manager to view organization members", () => {
    expect(canViewOrganizationMembers("owner")).toBe(true);
    expect(canViewOrganizationMembers("ops_manager")).toBe(true);
    expect(canViewOrganizationMembers("finance")).toBe(false);
    expect(canViewOrganizationMembers("streamer")).toBe(false);
  });

  it("keeps destructive organization member management owner-only", () => {
    expect(canManageOrganizationMembers("owner")).toBe(true);
    expect(canManageOrganizationMembers("ops_manager")).toBe(false);
    expect(canManageOrganizationMembers("operator_business")).toBe(false);
  });

  it("maps account creation permissions by creator role", () => {
    expect(getCreatableOrganizationMemberRoles("owner")).toEqual([
      "owner",
      "ops_manager",
      "operator_business",
      "finance",
      "streamer",
    ]);
    expect(getCreatableOrganizationMemberRoles("ops_manager")).toEqual([
      "ops_manager",
      "operator_business",
      "streamer",
    ]);
    expect(getCreatableOrganizationMemberRoles("operator_business")).toEqual([
      "streamer",
    ]);
    expect(getCreatableOrganizationMemberRoles("finance")).toEqual([]);

    expect(canCreateOrganizationMemberRole("ops_manager", "finance")).toBe(
      false,
    );
    expect(
      canCreateOrganizationMemberRole("operator_business", "streamer"),
    ).toBe(true);
  });
});
