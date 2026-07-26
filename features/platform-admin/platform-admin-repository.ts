import type {
  OrganizationLifecycleStatus,
  PlatformAuditDto,
  PlatformMetricOrganization,
  PlatformMetricTransaction,
  PlatformOrderDto,
  PlatformOrganizationCost,
  PlatformPlanPerformanceDto,
  PlatformSubscriptionDto,
  PlatformUserDto,
  ReportingPeriod,
} from "./platform-admin-contracts";

export type OrganizationListQuery = {
  search?: string;
  lifecycleStatus?: OrganizationLifecycleStatus;
  planId?: string;
  expiry?: "expired" | "within7Days" | "within30Days";
  page: number;
  pageSize: number;
  period: ReportingPeriod;
};

export type UserListQuery = {
  search?: string;
  organizationId?: string;
  role?: string;
  status?: string;
  page: number;
  pageSize: number;
};

export type OrderListQuery = {
  search?: string;
  organizationId?: string;
  status?: string;
  page: number;
  pageSize: number;
  period: ReportingPeriod;
};

export type AuditListQuery = {
  organizationId?: string;
  action?: string;
  result?: string;
  page: number;
  pageSize: number;
  period: ReportingPeriod;
};

export type OrganizationPrimaryAccountSource = {
  userId: string;
  email: string;
  name: string;
  assignmentSource: string;
  confirmedAt: string | null;
};

export type OrganizationSource = {
  id: string;
  name: string;
  code: string;
  lifecycleStatus: OrganizationLifecycleStatus;
  createdAt: string;
  memberCount: number;
  primaryAccount: OrganizationPrimaryAccountSource | null;
  subscription: PlatformSubscriptionDto | null;
  netRevenueCents: number;
  cost: {
    costCents: number;
    complete: boolean;
  } | null;
};

export type OrganizationPageSource = {
  items: OrganizationSource[];
  total: number;
  page: number;
  pageSize: number;
};

export type OrganizationDetailSource = OrganizationSource & {
  members: PlatformUserDto[];
  recentOrders: PlatformOrderDto[];
};

export type UserPageSource = {
  items: PlatformUserDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type OrderPageSource = {
  items: PlatformOrderDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type AuditPageSource = {
  items: PlatformAuditDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type PlatformOverviewSource = {
  organizations: PlatformMetricOrganization[];
  transactions: PlatformMetricTransaction[];
  organizationCosts: PlatformOrganizationCost[];
  forecastRevenueCents: number;
  subscriptionPeriodEnds: string[];
  today: string;
};

export type PlatformAdminRepository = {
  listOrganizations(
    query: OrganizationListQuery,
  ): Promise<OrganizationPageSource>;
  getOrganizationDetail(
    id: string,
    period: ReportingPeriod,
  ): Promise<OrganizationDetailSource | null>;
  listUsers(query: UserListQuery): Promise<UserPageSource>;
  listPlans(period: ReportingPeriod): Promise<PlatformPlanPerformanceDto[]>;
  listOrders(query: OrderListQuery): Promise<OrderPageSource>;
  listAudit(query: AuditListQuery): Promise<AuditPageSource>;
  loadOverviewSource(period: ReportingPeriod): Promise<PlatformOverviewSource>;
};
