import { describe, expect, it } from "vitest";

import { sanitizeHermesPageContext } from "./page-context";

describe("Hermes page context contract", () => {
  it("accepts known page types and sorts object ids", () => {
    expect(
      sanitizeHermesPageContext({
        pageType: "streamer",
        objectIds: [UUID_B, UUID_A],
      }),
    ).toEqual({
      pageType: "streamer",
      objectIds: [UUID_A, UUID_B],
    });
  });

  it("rejects unknown keys, duplicate ids, too many ids, actor fields, and unknown page types", () => {
    expect(sanitizeHermesPageContext({ pageType: "campaign" })).toBeNull();
    expect(
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: [UUID_A],
        tab: "overview",
      }),
    ).toBeNull();
    expect(
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: [UUID_A],
        userId: UUID_B,
      }),
    ).toBeNull();
    expect(
      sanitizeHermesPageContext({
        pageType: "project",
        objectIds: [UUID_A, UUID_A],
      }),
    ).toBeNull();
    expect(
      sanitizeHermesPageContext({
        pageType: "knowledge",
        objectIds: Array.from(
          { length: 21 },
          (_, index) =>
            `11111111-1111-4111-8${String(index).padStart(3, "0")}-111111111111`,
        ),
      }),
    ).toBeNull();
  });
});

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
