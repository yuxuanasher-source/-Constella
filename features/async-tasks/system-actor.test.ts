import { describe, expect, it } from "vitest";

import { createWorkerActor } from "./system-actor";

describe("createWorkerActor", () => {
  it("creates an organization-scoped system actor without a human user id", () => {
    expect(
      createWorkerActor({
        organizationId: "org-1",
        workerId: "ocr:host-a:1",
      }),
    ).toEqual({
      actorKind: "system",
      organizationId: "org-1",
      userId: undefined,
      name: "Background Worker",
      role: "ops_manager",
      workerId: "ocr:host-a:1",
    });
  });
});
