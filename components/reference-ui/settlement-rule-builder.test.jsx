import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SettlementRuleBuilder, {
  builderRuleFromStored,
  serializeBuilderRule,
} from "./settlement-rule-builder";

describe("settlement rule builder helpers", () => {
  it("round-trips a stored rule into the editable draft", () => {
    const draft = builderRuleFromStored({
      hourlyTiers: [{ uptoMinutes: 120, ratePerHour: 60 }],
      penalties: [
        {
          trigger: "red_evidence",
          mode: "percent",
          value: 5000,
          label: "扣半",
        },
      ],
      floorAmount: 100,
      capAmount: 2000,
    });

    expect(draft.hourlyTiers).toEqual([
      { uptoMinutes: "120", ratePerHour: "60" },
    ]);
    expect(draft.penalties[0]).toMatchObject({
      trigger: "red_evidence",
      mode: "percent",
      value: "5000",
      label: "扣半",
    });
    expect(draft.floorAmount).toBe("100");
    expect(draft.capAmount).toBe("2000");
  });

  it("serializes the draft into a numeric payload and drops blank rows", () => {
    const payload = serializeBuilderRule({
      hourlyTiers: [
        { uptoMinutes: "120", ratePerHour: "60" },
        { uptoMinutes: "", ratePerHour: "" },
      ],
      penalties: [
        {
          key: "p1",
          trigger: "red_evidence",
          mode: "percent",
          value: "50",
          label: "",
        },
        {
          key: "p2",
          trigger: "non_system_time",
          mode: "fixed",
          value: "",
          label: "",
        },
      ],
      floorAmount: "100",
      capAmount: "",
    });

    expect(payload.hourlyTiers).toEqual([
      { uptoMinutes: 120, ratePerHour: 60 },
    ]);
    expect(payload.penalties).toEqual([
      {
        key: "p1",
        trigger: "red_evidence",
        mode: "percent",
        value: 50,
        label: undefined,
      },
    ]);
    expect(payload.floorAmount).toBe(100);
    expect(payload.capAmount).toBeUndefined();
  });
});

describe("SettlementRuleBuilder", () => {
  const emptyDraft = {
    hourlyTiers: [],
    penalties: [],
    floorAmount: "",
    capAmount: "",
  };

  it("adds a tier through the builder and reports the change", () => {
    const onChange = vi.fn();
    render(
      <SettlementRuleBuilder
        value={emptyDraft}
        onChange={onChange}
        flatHourlyRate={80}
        method="cpt"
      />,
    );

    fireEvent.click(screen.getByText("+ 增加档位"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        hourlyTiers: [{ uptoMinutes: "", ratePerHour: "" }],
      }),
    );
  });

  it("renders a live preview using the real settlement engine", () => {
    // flat ¥80/h over the default 180-minute sample = ¥240.00
    render(
      <SettlementRuleBuilder
        value={emptyDraft}
        onChange={vi.fn()}
        flatHourlyRate={80}
        method="cpt"
      />,
    );

    expect(screen.getByText("实时预览")).toBeInTheDocument();
    expect(screen.getAllByText("¥240.00").length).toBeGreaterThan(0);
  });
});
