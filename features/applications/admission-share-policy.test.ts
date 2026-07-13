import { describe, expect, it } from "vitest";

import { canShareAdmissionRecordingsForProject } from "./admission-share-policy";

describe("admission share project policy", () => {
  it.each(["recruiting", "pending_start", "active", "paused", "ended"])(
    "allows recording shares while project status is %s",
    (status) => {
      expect(canShareAdmissionRecordingsForProject(status)).toBe(true);
    },
  );

  it.each(["draft", "settling", "archived", null, undefined])(
    "blocks recording shares when project status is %s",
    (status) => {
      expect(canShareAdmissionRecordingsForProject(status)).toBe(false);
    },
  );
});
