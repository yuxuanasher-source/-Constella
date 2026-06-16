import { describe, expect, it } from "vitest";

import { statusForServiceError } from "./route-error-status";

describe("statusForServiceError", () => {
  it("maps complex cost entitlement failures to forbidden", () => {
    expect(
      statusForServiceError(
        new Error("Complex cost rules are not enabled for this project"),
      ),
    ).toBe(403);
  });
});
