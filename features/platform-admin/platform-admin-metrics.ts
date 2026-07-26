import type {
  PlatformMetricOrganization,
  PlatformMetricTransaction,
  PlatformOrganizationCost,
  PlatformOverviewDto,
} from "./platform-admin-contracts";

type PlatformMetricResult = Omit<PlatformOverviewDto, "period">;

export function calculatePlatformMetrics(input: {
  organizations: PlatformMetricOrganization[];
  transactions: PlatformMetricTransaction[];
  organizationCosts: PlatformOrganizationCost[];
  forecastRevenueCents?: number;
  expiry?: {
    today: string;
    periodEnds: string[];
  };
}): PlatformMetricResult {
  const currentOrganizations = input.organizations.filter(
    (organization) => organization.lifecycleStatus !== "archived",
  );
  const successfulTransactions = input.transactions.filter(
    (transaction) => transaction.status === "succeeded",
  );
  const successfulPayments = successfulTransactions.filter(
    (transaction) => transaction.type === "payment",
  );
  const netRevenueCents = successfulTransactions.reduce(
    (total, transaction) =>
      total +
      (transaction.type === "payment"
        ? transaction.amountCents
        : -transaction.amountCents),
    0,
  );

  const revenueByOrganization = new Map<string, number>();
  successfulTransactions.forEach((transaction) => {
    const signedAmount =
      transaction.type === "payment"
        ? transaction.amountCents
        : -transaction.amountCents;
    revenueByOrganization.set(
      transaction.organizationId,
      (revenueByOrganization.get(transaction.organizationId) ?? 0) +
        signedAmount,
    );
  });

  const currentOrganizationIds = new Set(
    currentOrganizations.map((organization) => organization.id),
  );
  const completeCosts = new Map(
    input.organizationCosts
      .filter(
        (cost) =>
          cost.complete && currentOrganizationIds.has(cost.organizationId),
      )
      .map((cost) => [cost.organizationId, cost.costCents]),
  );
  const computableContributionMarginCents = [...completeCosts].reduce(
    (total, [organizationId, costCents]) =>
      total + (revenueByOrganization.get(organizationId) ?? 0) - costCents,
    0,
  );
  const organizationCount = currentOrganizations.length;

  return {
    organizationCount,
    payingOrganizationCount: new Set(
      successfulPayments.map((transaction) => transaction.organizationId),
    ).size,
    successfulOrderCount: new Set(
      successfulPayments.map((transaction) => transaction.orderId),
    ).size,
    netRevenueCents,
    forecastRevenueCents: input.forecastRevenueCents ?? 0,
    arpCents:
      organizationCount === 0
        ? null
        : Math.round(netRevenueCents / organizationCount),
    computableContributionMarginCents,
    costCoverage: {
      covered: completeCosts.size,
      total: organizationCount,
    },
    expiry: input.expiry
      ? calculateExpiryBuckets(input.expiry)
      : { expired: 0, within7Days: 0, within30Days: 0 },
  };
}

export function calculateExpiryBuckets(input: {
  today: string;
  periodEnds: string[];
}): PlatformOverviewDto["expiry"] {
  const today = utcDateKeyToDay(input.today);
  return input.periodEnds.reduce<PlatformOverviewDto["expiry"]>(
    (buckets, periodEnd) => {
      const daysRemaining = utcDateKeyToDay(periodEnd) - today;
      if (daysRemaining < 0) {
        buckets.expired += 1;
      } else if (daysRemaining <= 7) {
        buckets.within7Days += 1;
      } else if (daysRemaining <= 30) {
        buckets.within30Days += 1;
      }
      return buckets;
    },
    { expired: 0, within7Days: 0, within30Days: 0 },
  );
}

function utcDateKeyToDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid UTC date key: ${value}`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid UTC date key: ${value}`);
  }
  return Math.floor(timestamp / 86_400_000);
}
