import { describe, expect, it } from "vitest";

import { OPS_MODULE_ROUTES, routeForOpsModule } from "./module-route-map";

describe("OPS_MODULE_ROUTES", () => {
  it("covers all M0-M11 modules with readable Chinese labels", () => {
    expect(OPS_MODULE_ROUTES.map((item) => item.module)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "m11",
    ]);
    expect(OPS_MODULE_ROUTES.map((item) => item.label)).toContain(
      "M11 商业化与套餐",
    );
    expect(
      OPS_MODULE_ROUTES.every((item) => item.label.includes("�")),
    ).toBe(false);
  });

  it("routes M11 to billing instead of warroom", () => {
    expect(routeForOpsModule("m10")?.routeKey).toBe("warroom");
    expect(routeForOpsModule("m11")?.routeKey).toBe("billing");
  });
});
