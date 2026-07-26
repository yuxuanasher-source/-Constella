export type OrganizationLifecycleStatus = "active" | "frozen" | "archived";

export type ReportingPeriod = {
  start: string;
  end: string;
};

export type PlatformOverviewDto = {
  period: ReportingPeriod;
  organizationCount: number;
  payingOrganizationCount: number;
  successfulOrderCount: number;
  netRevenueCents: number;
  forecastRevenueCents: number;
  arpCents: number | null;
  computableContributionMarginCents: number;
  costCoverage: { covered: number; total: number };
  expiry: { expired: number; within7Days: number; within30Days: number };
};

export type PlatformMetricOrganization = {
  id: string;
  lifecycleStatus: OrganizationLifecycleStatus;
};

export type PlatformMetricTransaction = {
  organizationId: string;
  orderId: string;
  type: "payment" | "refund";
  status: "created" | "succeeded" | "failed";
  amountCents: number;
};

export type PlatformOrganizationCost = {
  organizationId: string;
  costCents: number;
  complete: boolean;
};
