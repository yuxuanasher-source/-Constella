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

export type PlatformPrimaryAccountDto =
  | {
      status: "confirmed";
      userId: string;
      email: string;
      name: string;
      assignmentSource: string;
      confirmedAt: string | null;
    }
  | {
      status: "pending";
      userId: null;
      email: null;
      name: null;
    };

export type PlatformSubscriptionDto = {
  id: string;
  status: string;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: {
    id: string;
    code: string;
    name: string;
  };
};

export type PlatformOrganizationMetricsDto = {
  netRevenueCents: number;
  costCents: number | null;
  contributionMarginCents: number | null;
};

export type PlatformOrganizationListItemDto = {
  id: string;
  name: string;
  code: string;
  lifecycleStatus: OrganizationLifecycleStatus;
  createdAt: string;
  memberCount: number;
  primaryAccount: PlatformPrimaryAccountDto;
  subscription: PlatformSubscriptionDto | null;
  metrics: PlatformOrganizationMetricsDto;
};

export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
};

export type OrganizationPageDto = {
  items: PlatformOrganizationListItemDto[];
  meta: PageMeta;
};

export type PlatformUserDto = {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  joinedAt: string;
  isPrimaryAccount: boolean;
};

export type PlatformOrderDto = {
  id: string;
  organizationId: string;
  organizationName: string;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
  planName: string | null;
  billingCycle: string | null;
  provider: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type PlatformAuditDto = {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  reason: string | null;
  isHighRisk: boolean;
  result: string;
  errorMessage: string | null;
  traceId: string;
  createdAt: string;
};

export type PlatformPlanPerformanceDto = {
  id: string;
  code: string;
  name: string;
  tier: string;
  activeSubscriptionCount: number;
  payingOrganizationCount: number;
  netRevenueCents: number;
  standardCostCents: number | null;
  contributionMarginCents: number | null;
};

export type PlatformOrganizationDetailDto = PlatformOrganizationListItemDto & {
  members: PlatformUserDto[];
  recentOrders: PlatformOrderDto[];
};

export type PlatformUserPageDto = {
  items: PlatformUserDto[];
  meta: PageMeta;
};

export type PlatformOrderPageDto = {
  items: PlatformOrderDto[];
  meta: PageMeta;
};

export type PlatformAuditPageDto = {
  items: PlatformAuditDto[];
  meta: PageMeta;
};
