import { describe, expect, it } from "vitest";

import { isAdmissionShareBrandUiEnabled } from "./admission-share-brand-ui-flag";

describe("isAdmissionShareBrandUiEnabled", () => {
  it.each(["true", "1", "yes", "on", " TRUE ", " Yes "])(
    "enables the branded public share UI only for an explicit enabled value: %s",
    (value) => {
      expect(
        isAdmissionShareBrandUiEnabled({ ADMISSION_SHARE_BRAND_UI: value }),
      ).toBe(true);
    },
  );

  it.each([undefined, "", "false", "0", "off", "enabled", "no"])(
    "keeps the branded public share UI disabled by default: %s",
    (value) => {
      expect(
        isAdmissionShareBrandUiEnabled({ ADMISSION_SHARE_BRAND_UI: value }),
      ).toBe(false);
    },
  );
});
