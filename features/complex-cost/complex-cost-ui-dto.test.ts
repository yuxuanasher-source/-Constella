import { describe, expect, it } from "vitest";

import { toComplexCostDashboardDto } from "./complex-cost-ui-dto";

describe("complex cost UI DTO", () => {
  it("hides gross margin and supplier cost from streamer-facing DTOs", () => {
    expect(
      toComplexCostDashboardDto(
        {
          expectedReceivableCents: 100000,
          supplierCostCents: 30000,
          grossMarginCents: 40000,
          items: [],
        },
        "streamer",
      ),
    ).toEqual({ items: [] });
  });
});
