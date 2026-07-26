import type {
  OrganizationPageDto,
  PlatformAuditPageDto,
  PlatformOrganizationDetailDto,
  PlatformOrganizationListItemDto,
  PlatformOrderPageDto,
  PlatformOverviewDto,
  PlatformPlanPerformanceDto,
  PlatformUserPageDto,
  ReportingPeriod,
} from "./platform-admin-contracts";
import { calculatePlatformMetrics } from "./platform-admin-metrics";
import type {
  AuditListQuery,
  OrderListQuery,
  OrganizationListQuery,
  OrganizationSource,
  PlatformAdminRepository,
  UserListQuery,
} from "./platform-admin-repository";

export class PlatformAdminNotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "PlatformAdminNotFoundError";
  }
}

export async function loadPlatformOverview(input: {
  repo: PlatformAdminRepository;
  period: ReportingPeriod;
}): Promise<PlatformOverviewDto> {
  const source = await input.repo.loadOverviewSource(input.period);
  return {
    period: input.period,
    ...calculatePlatformMetrics({
      organizations: source.organizations,
      transactions: source.transactions,
      organizationCosts: source.organizationCosts,
      forecastRevenueCents: source.forecastRevenueCents,
      expiry: {
        today: source.today,
        periodEnds: source.subscriptionPeriodEnds,
      },
    }),
  };
}

export async function listPlatformOrganizations(input: {
  repo: PlatformAdminRepository;
  query: OrganizationListQuery;
}): Promise<OrganizationPageDto> {
  const query = normalizeOrganizationQuery(input.query);
  const source = await input.repo.listOrganizations(query);
  const items = source.items
    .map(mapOrganization)
    .sort(compareOrganizationsByExpiry);

  return {
    items,
    meta: {
      page: source.page,
      pageSize: source.pageSize,
      total: source.total,
    },
  };
}

export async function getPlatformOrganizationDetail(input: {
  repo: PlatformAdminRepository;
  organizationId: string;
  period: ReportingPeriod;
}): Promise<PlatformOrganizationDetailDto> {
  const source = await input.repo.getOrganizationDetail(
    input.organizationId,
    input.period,
  );
  if (!source) {
    throw new PlatformAdminNotFoundError("Organization", input.organizationId);
  }

  return {
    ...mapOrganization(source),
    members: source.members,
    recentOrders: source.recentOrders,
  };
}

export async function listPlatformUsers(input: {
  repo: PlatformAdminRepository;
  query: UserListQuery;
}): Promise<PlatformUserPageDto> {
  const source = await input.repo.listUsers(normalizeUserQuery(input.query));
  return {
    items: source.items,
    meta: pageMeta(source),
  };
}

export async function listPlatformPlans(input: {
  repo: PlatformAdminRepository;
  period: ReportingPeriod;
}): Promise<PlatformPlanPerformanceDto[]> {
  return input.repo.listPlans(input.period);
}

export async function listPlatformOrders(input: {
  repo: PlatformAdminRepository;
  query: OrderListQuery;
}): Promise<PlatformOrderPageDto> {
  const source = await input.repo.listOrders(normalizeOrderQuery(input.query));
  return {
    items: source.items,
    meta: pageMeta(source),
  };
}

export async function listPlatformAudit(input: {
  repo: PlatformAdminRepository;
  query: AuditListQuery;
}): Promise<PlatformAuditPageDto> {
  const source = await input.repo.listAudit(normalizeAuditQuery(input.query));
  return {
    items: source.items,
    meta: pageMeta(source),
  };
}

function mapOrganization(
  source: OrganizationSource,
): PlatformOrganizationListItemDto {
  const costCents = source.cost?.complete ? source.cost.costCents : null;
  return {
    id: source.id,
    name: source.name,
    code: source.code,
    lifecycleStatus: source.lifecycleStatus,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    memberCount: source.memberCount,
    primaryAccount: source.primaryAccount
      ? {
          status: "confirmed",
          userId: source.primaryAccount.userId,
          email: source.primaryAccount.email,
          name: source.primaryAccount.name,
          assignmentSource: source.primaryAccount.assignmentSource,
          confirmedAt: source.primaryAccount.confirmedAt,
        }
      : {
          status: "pending",
          userId: null,
          email: null,
          name: null,
        },
    subscription: source.subscription,
    metrics: {
      netRevenueCents: source.netRevenueCents,
      costCents,
      contributionMarginCents:
        costCents === null ? null : source.netRevenueCents - costCents,
    },
  };
}

function compareOrganizationsByExpiry(
  left: PlatformOrganizationListItemDto,
  right: PlatformOrganizationListItemDto,
) {
  const leftExpiry = left.subscription?.currentPeriodEnd ?? "9999-12-31";
  const rightExpiry = right.subscription?.currentPeriodEnd ?? "9999-12-31";
  const expiryOrder = leftExpiry.localeCompare(rightExpiry);
  if (expiryOrder !== 0) {
    return expiryOrder;
  }
  const nameOrder = left.name.localeCompare(right.name, "zh-CN");
  return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
}

function normalizeOrganizationQuery(
  query: OrganizationListQuery,
): OrganizationListQuery {
  return {
    ...query,
    ...(query.search ? { search: normalizeSearch(query.search) } : {}),
    page: normalizePage(query.page),
    pageSize: normalizePageSize(query.pageSize),
  };
}

function normalizeUserQuery(query: UserListQuery): UserListQuery {
  return {
    ...query,
    ...(query.search ? { search: normalizeSearch(query.search) } : {}),
    page: normalizePage(query.page),
    pageSize: normalizePageSize(query.pageSize),
  };
}

function normalizeOrderQuery(query: OrderListQuery): OrderListQuery {
  return {
    ...query,
    ...(query.search ? { search: normalizeSearch(query.search) } : {}),
    page: normalizePage(query.page),
    pageSize: normalizePageSize(query.pageSize),
  };
}

function normalizeAuditQuery(query: AuditListQuery): AuditListQuery {
  return {
    ...query,
    page: normalizePage(query.page),
    pageSize: normalizePageSize(query.pageSize),
  };
}

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePage(value: number) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizePageSize(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    return 20;
  }
  return Math.min(value, 100);
}

function pageMeta(source: { page: number; pageSize: number; total: number }) {
  return {
    page: source.page,
    pageSize: source.pageSize,
    total: source.total,
  };
}
