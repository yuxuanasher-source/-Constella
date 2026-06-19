export type ProjectFinancialSettings = {
  isInvoiced: boolean;
  outputVatRateBps: number;
  surtaxRateBps: number;
  procurementCostCents: number;
};

export type ProjectFinancialResult = {
  isInvoiced: boolean;
  outputVatRateBps: number;
  surtaxRateBps: number;
  // Output VAT charged on the receivable when an invoice is issued.
  outputVatCents: number;
  // Surtax (城建/教育附加等) levied on top of the VAT amount.
  surtaxCents: number;
  procurementCostCents: number;
  // outputVat + surtax + procurement: the extra cost this layer adds to P&L.
  totalFinancialCostCents: number;
};

export const DEFAULT_PROJECT_FINANCIAL_SETTINGS: ProjectFinancialSettings = {
  isInvoiced: false,
  outputVatRateBps: 0,
  surtaxRateBps: 0,
  procurementCostCents: 0,
};

/**
 * Compute the tax + procurement cost a project's financial settings add to the
 * P&L. VAT is only charged when an invoice is issued; surtax is levied on the
 * VAT amount; procurement is a flat cost. All amounts are in cents.
 */
export function calculateProjectFinancials({
  expectedReceivableCents,
  settings,
}: {
  expectedReceivableCents: number;
  settings: ProjectFinancialSettings;
}): ProjectFinancialResult {
  const receivable = nonnegative(expectedReceivableCents);
  const isInvoiced = Boolean(settings.isInvoiced);
  const outputVatRateBps = clampBps(settings.outputVatRateBps);
  const surtaxRateBps = clampBps(settings.surtaxRateBps);
  const procurementCostCents = nonnegative(settings.procurementCostCents);

  const outputVatCents = isInvoiced
    ? Math.round((receivable * outputVatRateBps) / 10000)
    : 0;
  const surtaxCents = Math.round((outputVatCents * surtaxRateBps) / 10000);
  const totalFinancialCostCents =
    outputVatCents + surtaxCents + procurementCostCents;

  return {
    isInvoiced,
    outputVatRateBps,
    surtaxRateBps,
    outputVatCents,
    surtaxCents,
    procurementCostCents,
    totalFinancialCostCents,
  };
}

export function normalizeProjectFinancialSettings(
  input: Partial<ProjectFinancialSettings> | null | undefined,
): ProjectFinancialSettings {
  return {
    isInvoiced: Boolean(input?.isInvoiced),
    outputVatRateBps: clampBps(input?.outputVatRateBps ?? 0),
    surtaxRateBps: clampBps(input?.surtaxRateBps ?? 0),
    procurementCostCents: nonnegative(input?.procurementCostCents ?? 0),
  };
}

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10000, Math.trunc(value)));
}

function nonnegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
