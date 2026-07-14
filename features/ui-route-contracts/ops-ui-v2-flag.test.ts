import { describe, expect, it } from "vitest";

import { isOpsUiV2Enabled } from "./ops-ui-v2-flag";

describe("isOpsUiV2Enabled", () => {
  it.each(["true", "TRUE", "1", "yes", "on"])(
    "enables the ops UI v2 shell for %s",
    (value) => {
      expect(isOpsUiV2Enabled({ NEXT_PUBLIC_OPS_UI_V2: value })).toBe(true);
    },
  );

  it.each([undefined, "", "false", "0", "no", "off", "beta"])(
    "keeps the ops UI v2 shell disabled for %s",
    (value) => {
      expect(isOpsUiV2Enabled({ NEXT_PUBLIC_OPS_UI_V2: value })).toBe(false);
    },
  );
});
