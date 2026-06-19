import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProjectFinancialSettings, {
  financialDraftFromProject,
  serializeFinancialDraft,
} from "./project-financial-settings";

describe("project financial settings helpers", () => {
  it("builds a draft from project bps/cents and serializes back", () => {
    const draft = financialDraftFromProject({
      isInvoiced: true,
      outputVatRateBps: 600,
      surtaxRateBps: 1200,
      procurementCostCents: 50_000,
    });
    expect(draft).toEqual({
      isInvoiced: true,
      outputVatRatePct: "6",
      surtaxRatePct: "12",
      procurementCostYuan: "500",
    });

    expect(serializeFinancialDraft(draft)).toEqual({
      isInvoiced: true,
      outputVatRateBps: 600,
      surtaxRateBps: 1200,
      procurementCostCents: 50_000,
    });
  });
});

describe("ProjectFinancialSettings", () => {
  const draft = {
    isInvoiced: true,
    outputVatRatePct: "6",
    surtaxRatePct: "12",
    procurementCostYuan: "500",
  };

  it("shows the computed tax and procurement total", () => {
    render(
      <ProjectFinancialSettings
        value={draft}
        onChange={vi.fn()}
        expectedReceivableCents={1_000_000}
      />,
    );

    // VAT = 1,000,000 cents * 6% = 60,000 cents = ¥600.00
    expect(screen.getByText("¥600.00")).toBeInTheDocument();
    // surtax = 60,000 * 12% = 7,200 cents = ¥72.00
    expect(screen.getByText("¥72.00")).toBeInTheDocument();
    // total = VAT 600 + surtax 72 + procurement 500 = ¥1,172.00
    expect(screen.getByText("¥1,172.00")).toBeInTheDocument();
  });

  it("toggles invoicing and reports the change", () => {
    const onChange = vi.fn();
    render(
      <ProjectFinancialSettings
        value={{ ...draft, isInvoiced: false }}
        onChange={onChange}
        expectedReceivableCents={1_000_000}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ isInvoiced: true }),
    );
  });
});
