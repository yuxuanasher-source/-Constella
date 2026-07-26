import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  OrganizationLifecycleStatus,
  PlatformAuditDto,
  PlatformCostModelDto,
  PlatformMetricTransaction,
  PlatformOrderDto,
  PlatformOrganizationCost,
  PlatformPlanPerformanceDto,
  PlatformSubscriptionDto,
  PlatformUserDto,
  ReportingPeriod,
} from "./platform-admin-contracts";
import type {
  AuditListQuery,
  OrderListQuery,
  OrganizationDetailSource,
  OrganizationListQuery,
  OrganizationPageSource,
  OrganizationPrimaryAccountSource,
  OrganizationSource,
  PlatformAdminRepository,
  PlatformOverviewSource,
  UserListQuery,
  UserPageSource,
} from "./platform-admin-repository";

type Relation<T> = T | T[] | null;

type OrganizationRow = {
  id: string;
  name: string;
  code: string;
  lifecycle_status: OrganizationLifecycleStatus;
  created_at: string;
  updated_at: string;
  organization_primary_accounts: Relation<{
    user_id: string;
    assignment_source: string;
    confirmed_at: string | null;
    profiles: Relation<{ email: string; full_name: string }>;
  }>;
  organization_members: Array<{ count: number }>;
  organization_subscriptions: Relation<{
    id: string;
    status: string;
    billing_cycle: string;
    current_period_start: string;
    current_period_end: string;
    updated_at: string;
    billing_plans: Relation<{ id: string; code: string; name: string }>;
  }>;
};

type UsageRow = {
  organization_id: string;
  metric: string;
  used_quantity: number;
};

type CostVersionRow = {
  plan_id: string;
  effective_from: string;
  effective_to: string | null;
  fixed_cost_cents: number;
  per_seat_cost_cents: number;
  per_active_streamer_cost_cents: number;
  metric_unit_costs: Record<string, unknown>;
};

type SubscriptionCostRow = {
  organization_id: string;
  plan_id: string;
};

type TransactionRow = {
  organization_id: string;
  order_id: string;
  type: "payment" | "refund";
  status: "created" | "succeeded" | "failed";
  amount_cents: number;
};

export class SupabasePlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listOrganizations(
    query: OrganizationListQuery,
  ): Promise<OrganizationPageSource> {
    const eligibleIds = await this.loadEligibleOrganizationIds(query);
    if (eligibleIds && eligibleIds.length === 0) {
      return {
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    let request = this.client
      .from("organizations")
      .select(organizationSelect, { count: "exact" });

    if (query.search) {
      const pattern = `%${escapePostgrestLike(query.search)}%`;
      request = request.or(
        `name.ilike.${quotePostgrestValue(pattern)},code.ilike.${quotePostgrestValue(pattern)}`,
      );
    }
    if (query.lifecycleStatus) {
      request = request.eq("lifecycle_status", query.lifecycleStatus);
    }
    if (eligibleIds) {
      request = request.in("id", eligibleIds);
    }

    const { from, to } = pageRange(query.page, query.pageSize);
    const result = await request
      .order("name", { ascending: true })
      .range(from, to);
    assertNoError(result.error, "list organizations");

    const rows = (result.data ?? []) as unknown as OrganizationRow[];
    const items = await this.enrichOrganizations(rows, query.period);
    return {
      items,
      total: result.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getOrganizationDetail(
    id: string,
    period: ReportingPeriod,
  ): Promise<OrganizationDetailSource | null> {
    const result = await this.client
      .from("organizations")
      .select(organizationSelect)
      .eq("id", id)
      .maybeSingle();
    assertNoError(result.error, "load organization");
    if (!result.data) {
      return null;
    }

    const [organization] = await this.enrichOrganizations(
      [result.data as unknown as OrganizationRow],
      period,
    );
    const [members, recentOrders] = await Promise.all([
      this.loadOrganizationMembers(id, organization.primaryAccount?.userId),
      this.loadRecentOrganizationOrders(id),
    ]);
    return { ...organization, members, recentOrders };
  }

  async listUsers(query: UserListQuery): Promise<UserPageSource> {
    let profileIds: string[] | null = null;
    if (query.search) {
      const pattern = `%${escapePostgrestLike(query.search)}%`;
      const profileResult = await this.client
        .from("profiles")
        .select("id")
        .or(
          `email.ilike.${quotePostgrestValue(pattern)},full_name.ilike.${quotePostgrestValue(pattern)}`,
        )
        .limit(1000);
      assertNoError(profileResult.error, "search profiles");
      profileIds = (profileResult.data ?? []).map((row) => row.id as string);
      if (profileIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
        };
      }
    }

    let request = this.client.from("organization_members").select(
      `
          id,
          organization_id,
          user_id,
          role,
          status,
          created_at,
          updated_at,
          profiles!organization_members_user_id_fkey(email, full_name),
          organizations!organization_members_organization_id_fkey(name)
        `,
      { count: "exact" },
    );
    if (profileIds) {
      request = request.in("user_id", profileIds);
    }
    if (query.organizationId) {
      request = request.eq("organization_id", query.organizationId);
    }
    if (query.role) {
      request = request.eq("role", query.role);
    }
    if (query.status) {
      request = request.eq("status", query.status);
    }

    const { from, to } = pageRange(query.page, query.pageSize);
    const result = await request
      .order("created_at", { ascending: false })
      .range(from, to);
    assertNoError(result.error, "list organization users");
    const rows = (result.data ?? []) as unknown as MemberRow[];
    const primaryPairs = await this.loadPrimaryPairs([
      ...new Set(rows.map((row) => row.organization_id)),
    ]);

    return {
      items: rows.map((row) => mapMember(row, primaryPairs)),
      total: result.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listPlans(
    period: ReportingPeriod,
  ): Promise<PlatformPlanPerformanceDto[]> {
    const [plansResult, subscriptionsResult, transactionsResult, costsResult] =
      await Promise.all([
        this.client
          .from("billing_plans")
          .select(
            "id, code, name, tier, monthly_price_cents, annual_price_cents, included_active_streamers, included_seats, included_ocr, included_ai, included_storage_mb, included_exports, features, updated_at",
          )
          .order("tier", { ascending: true }),
        this.client
          .from("organization_subscriptions")
          .select("organization_id, plan_id, status")
          .in("status", ["trialing", "active", "past_due", "readonly"]),
        this.client
          .from("billing_transactions")
          .select(
            `
              organization_id,
              order_id,
              type,
              status,
              amount_cents,
              billing_orders!inner(plan_id)
            `,
          )
          .gte("created_at", periodStartTimestamp(period))
          .lte("created_at", periodEndTimestamp(period)),
        this.client
          .from("billing_plan_cost_versions")
          .select(
            `
              plan_id,
              effective_from,
              effective_to,
              fixed_cost_cents,
              per_seat_cost_cents,
              per_active_streamer_cost_cents,
              metric_unit_costs
            `,
          )
          .lte("effective_from", periodEndTimestamp(period))
          .or(
            `effective_to.is.null,effective_to.gt.${periodStartTimestamp(period)}`,
          ),
      ]);
    assertNoError(plansResult.error, "list billing plans");
    assertNoError(subscriptionsResult.error, "list plan subscriptions");
    assertNoError(transactionsResult.error, "list plan transactions");
    assertNoError(costsResult.error, "list plan costs");

    const subscriptions = (subscriptionsResult.data ?? []) as Array<{
      organization_id: string;
      plan_id: string;
      status: string;
    }>;
    const transactions = (transactionsResult.data ?? []) as unknown as Array<
      TransactionRow & {
        billing_orders: Relation<{ plan_id: string | null }>;
      }
    >;
    const costs = (costsResult.data ?? []) as unknown as CostVersionRow[];

    return (plansResult.data ?? []).map((plan) => {
      const planSubscriptions = subscriptions.filter(
        (subscription) => subscription.plan_id === plan.id,
      );
      const planTransactions = transactions.filter(
        (transaction) =>
          firstRelation(transaction.billing_orders)?.plan_id === plan.id &&
          transaction.status === "succeeded",
      );
      const netRevenueCents = planTransactions.reduce(
        (total, transaction) =>
          total +
          (transaction.type === "payment"
            ? transaction.amount_cents
            : -transaction.amount_cents),
        0,
      );
      const cost = pickCostVersion(costs, plan.id, period.end);
      const standardCostCents = cost
        ? cost.fixed_cost_cents * planSubscriptions.length
        : null;
      return {
        id: plan.id as string,
        code: plan.code as string,
        name: plan.name as string,
        tier: plan.tier as string,
        updatedAt: plan.updated_at as string,
        included: {
          activeStreamers: plan.included_active_streamers as number,
          seats: plan.included_seats as number,
          ocr: plan.included_ocr as number,
          ai: plan.included_ai as number,
          storageMb: plan.included_storage_mb as number,
          exports: plan.included_exports as number,
        },
        features: booleanFeatures(plan.features),
        monthlyPriceCents: plan.monthly_price_cents as number,
        annualPriceCents: plan.annual_price_cents as number,
        activeSubscriptionCount: planSubscriptions.length,
        payingOrganizationCount: new Set(
          planTransactions
            .filter((transaction) => transaction.type === "payment")
            .map((transaction) => transaction.organization_id),
        ).size,
        netRevenueCents,
        standardCostCents,
        contributionMarginCents:
          standardCostCents === null
            ? null
            : netRevenueCents - standardCostCents,
      };
    });
  }

  async listCostModels(): Promise<PlatformCostModelDto[]> {
    const result = await this.client
      .from("billing_plan_cost_versions")
      .select(
        `
          id,
          plan_id,
          effective_from,
          effective_to,
          fixed_cost_cents,
          per_seat_cost_cents,
          per_active_streamer_cost_cents,
          metric_unit_costs,
          reason,
          billing_plans!billing_plan_cost_versions_plan_id_fkey(name, updated_at)
        `,
      )
      .order("effective_from", { ascending: false });
    assertNoError(result.error, "list plan cost models");

    return ((result.data ?? []) as unknown as CostModelRow[]).map((row) => {
      const metricUnitCosts = numericMetricCosts(row.metric_unit_costs);
      return {
        id: row.id,
        planId: row.plan_id,
        planName: firstRelation(row.billing_plans)?.name ?? "未知套餐",
        planUpdatedAt:
          firstRelation(row.billing_plans)?.updated_at ??
          "1970-01-01T00:00:00.000Z",
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        fixedCostCents: row.fixed_cost_cents,
        perSeatCostCents: row.per_seat_cost_cents,
        perActiveStreamerCostCents: row.per_active_streamer_cost_cents,
        metricUnitCosts,
        reason: row.reason,
        coverageComplete: ["ocr", "ai", "storage_mb", "export"].every(
          (metric) => typeof metricUnitCosts[metric] === "number",
        ),
      };
    });
  }

  async listOrders(query: OrderListQuery) {
    let organizationIds: string[] | null = null;
    if (query.search) {
      organizationIds = await this.searchOrganizationIds(query.search);
      if (organizationIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
        };
      }
    }

    let request = this.client
      .from("billing_orders")
      .select(orderSelect, { count: "exact" })
      .gte("created_at", periodStartTimestamp(query.period))
      .lte("created_at", periodEndTimestamp(query.period));
    if (query.organizationId) {
      request = request.eq("organization_id", query.organizationId);
    }
    if (organizationIds) {
      request = request.in("organization_id", organizationIds);
    }
    if (query.status) {
      request = request.eq("status", query.status);
    }

    const { from, to } = pageRange(query.page, query.pageSize);
    const result = await request
      .order("created_at", { ascending: false })
      .range(from, to);
    assertNoError(result.error, "list billing orders");
    return {
      items: ((result.data ?? []) as unknown as OrderRow[]).map(mapOrder),
      total: result.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listAudit(query: AuditListQuery) {
    let request = this.client
      .from("platform_admin_operation_logs")
      .select(
        `
          id,
          actor_user_id,
          action,
          target_type,
          target_id,
          target_organization_id,
          reason,
          is_high_risk,
          result,
          error_message,
          trace_id,
          before_json,
          after_json,
          created_at,
          profiles!platform_admin_operation_logs_actor_user_id_fkey(full_name),
          organizations!platform_admin_operation_logs_target_organization_id_fkey(name)
        `,
        { count: "exact" },
      )
      .gte("created_at", periodStartTimestamp(query.period))
      .lte("created_at", periodEndTimestamp(query.period));
    if (query.organizationId) {
      request = request.eq("target_organization_id", query.organizationId);
    }
    if (query.action) {
      request = request.eq("action", query.action);
    }
    if (query.result) {
      request = request.eq("result", query.result);
    }

    const { from, to } = pageRange(query.page, query.pageSize);
    const result = await request
      .order("created_at", { ascending: false })
      .range(from, to);
    assertNoError(result.error, "list platform audit");
    return {
      items: ((result.data ?? []) as unknown as AuditRow[]).map(mapAudit),
      total: result.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async loadOverviewSource(
    period: ReportingPeriod,
  ): Promise<PlatformOverviewSource> {
    const [organizationsResult, transactionsResult, subscriptionsResult] =
      await Promise.all([
        this.client
          .from("organizations")
          .select("id, lifecycle_status")
          .order("created_at", { ascending: true }),
        this.loadTransactions(period),
        this.client.from("organization_subscriptions").select(`
          organization_id,
          plan_id,
          billing_cycle,
          current_period_end
        `),
      ]);
    assertNoError(organizationsResult.error, "load overview organizations");
    assertNoError(subscriptionsResult.error, "load overview subscriptions");

    const organizations = (organizationsResult.data ?? []) as Array<{
      id: string;
      lifecycle_status: OrganizationLifecycleStatus;
    }>;
    const subscriptions = (subscriptionsResult.data ??
      []) as OverviewSubscriptionRow[];
    const organizationCosts = await this.loadOrganizationCosts(
      subscriptions.map((subscription) => ({
        organization_id: subscription.organization_id,
        plan_id: subscription.plan_id,
      })),
      period,
    );
    const forecastRevenueCents =
      await this.loadForecastRevenueCents(subscriptions);

    return {
      organizations: organizations.map((organization) => ({
        id: organization.id,
        lifecycleStatus: organization.lifecycle_status,
      })),
      transactions: transactionsResult,
      organizationCosts,
      forecastRevenueCents,
      subscriptionPeriodEnds: subscriptions.map(
        (subscription) => subscription.current_period_end,
      ),
      today: new Date().toISOString().slice(0, 10),
    };
  }

  private async enrichOrganizations(
    rows: OrganizationRow[],
    period: ReportingPeriod,
  ): Promise<OrganizationSource[]> {
    const organizationIds = rows.map((row) => row.id);
    if (organizationIds.length === 0) {
      return [];
    }

    const transactions = await this.loadTransactions(period, organizationIds);
    const netRevenue = netRevenueByOrganization(transactions);
    const subscriptions = rows
      .map((row) => {
        const subscription = firstRelation(row.organization_subscriptions);
        const plan = firstRelation(subscription?.billing_plans ?? null);
        return subscription && plan
          ? {
              organization_id: row.id,
              plan_id: plan.id,
            }
          : null;
      })
      .filter((value): value is SubscriptionCostRow => value !== null);
    const costs = new Map(
      (await this.loadOrganizationCosts(subscriptions, period)).map((cost) => [
        cost.organizationId,
        cost,
      ]),
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      lifecycleStatus: row.lifecycle_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memberCount: row.organization_members?.[0]?.count ?? 0,
      primaryAccount: mapPrimaryAccount(row.organization_primary_accounts),
      subscription: mapSubscription(row.organization_subscriptions),
      netRevenueCents: netRevenue.get(row.id) ?? 0,
      cost: costs.get(row.id) ?? null,
    }));
  }

  private async loadEligibleOrganizationIds(
    query: OrganizationListQuery,
  ): Promise<string[] | null> {
    if (!query.planId && !query.expiry) {
      return null;
    }

    let request = this.client
      .from("organization_subscriptions")
      .select("organization_id");
    if (query.planId) {
      request = request.eq("plan_id", query.planId);
    }
    if (query.expiry) {
      const today = new Date().toISOString().slice(0, 10);
      if (query.expiry === "expired") {
        request = request.lt("current_period_end", today);
      } else if (query.expiry === "within7Days") {
        request = request
          .gte("current_period_end", today)
          .lte("current_period_end", addUtcDays(today, 7));
      } else {
        request = request
          .gt("current_period_end", addUtcDays(today, 7))
          .lte("current_period_end", addUtcDays(today, 30));
      }
    }
    const result = await request.limit(10000);
    assertNoError(result.error, "filter organization subscriptions");
    return [
      ...new Set(
        (result.data ?? []).map((row) => row.organization_id as string),
      ),
    ];
  }

  private async loadTransactions(
    period: ReportingPeriod,
    organizationIds?: string[],
  ): Promise<PlatformMetricTransaction[]> {
    let request = this.client
      .from("billing_transactions")
      .select("organization_id, order_id, type, status, amount_cents")
      .gte("created_at", periodStartTimestamp(period))
      .lte("created_at", periodEndTimestamp(period));
    if (organizationIds) {
      request = request.in("organization_id", organizationIds);
    }
    const result = await request;
    assertNoError(result.error, "load billing transactions");
    return ((result.data ?? []) as unknown as TransactionRow[]).map(
      (transaction) => ({
        organizationId: transaction.organization_id,
        orderId: transaction.order_id,
        type: transaction.type,
        status: transaction.status,
        amountCents: transaction.amount_cents,
      }),
    );
  }

  private async loadOrganizationCosts(
    subscriptions: SubscriptionCostRow[],
    period: ReportingPeriod,
  ): Promise<PlatformOrganizationCost[]> {
    if (subscriptions.length === 0) {
      return [];
    }
    const organizationIds = [
      ...new Set(
        subscriptions.map((subscription) => subscription.organization_id),
      ),
    ];
    const planIds = [
      ...new Set(subscriptions.map((subscription) => subscription.plan_id)),
    ];
    const [usageResult, costsResult] = await Promise.all([
      this.client
        .from("usage_monthly_counters")
        .select("organization_id, metric, used_quantity")
        .in("organization_id", organizationIds)
        .gte("period_month", period.start)
        .lte("period_month", period.end),
      this.client
        .from("billing_plan_cost_versions")
        .select(
          `
            plan_id,
            effective_from,
            effective_to,
            fixed_cost_cents,
            per_seat_cost_cents,
            per_active_streamer_cost_cents,
            metric_unit_costs
          `,
        )
        .in("plan_id", planIds)
        .lte("effective_from", periodEndTimestamp(period))
        .or(
          `effective_to.is.null,effective_to.gt.${periodStartTimestamp(period)}`,
        ),
    ]);
    assertNoError(usageResult.error, "load organization usage");
    assertNoError(costsResult.error, "load plan cost versions");

    const usage = (usageResult.data ?? []) as unknown as UsageRow[];
    const costs = (costsResult.data ?? []) as unknown as CostVersionRow[];
    return subscriptions.map((subscription) =>
      calculateOrganizationCost(
        subscription,
        usage.filter(
          (row) => row.organization_id === subscription.organization_id,
        ),
        pickCostVersion(costs, subscription.plan_id, period.end),
      ),
    );
  }

  private async loadForecastRevenueCents(
    subscriptions: OverviewSubscriptionRow[],
  ) {
    const planIds = [
      ...new Set(subscriptions.map((subscription) => subscription.plan_id)),
    ];
    if (planIds.length === 0) {
      return 0;
    }
    const result = await this.client
      .from("billing_plan_prices")
      .select("plan_id, billing_cycle, price_cents")
      .in("plan_id", planIds)
      .eq("active", true);
    assertNoError(result.error, "load forecast plan prices");
    const prices = (result.data ?? []) as Array<{
      plan_id: string;
      billing_cycle: string;
      price_cents: number;
    }>;
    return subscriptions.reduce((total, subscription) => {
      const price = prices.find(
        (candidate) =>
          candidate.plan_id === subscription.plan_id &&
          candidate.billing_cycle === subscription.billing_cycle,
      );
      return total + (price?.price_cents ?? 0);
    }, 0);
  }

  private async loadOrganizationMembers(
    organizationId: string,
    primaryUserId?: string,
  ): Promise<PlatformUserDto[]> {
    const result = await this.client
      .from("organization_members")
      .select(
        `
          id,
          organization_id,
          user_id,
          role,
          status,
          created_at,
          updated_at,
          profiles!organization_members_user_id_fkey(email, full_name),
          organizations!organization_members_organization_id_fkey(name)
        `,
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });
    assertNoError(result.error, "load organization members");
    return ((result.data ?? []) as unknown as MemberRow[]).map((row) =>
      mapMember(
        row,
        new Set(primaryUserId ? [`${organizationId}:${primaryUserId}`] : []),
      ),
    );
  }

  private async loadRecentOrganizationOrders(
    organizationId: string,
  ): Promise<PlatformOrderDto[]> {
    const result = await this.client
      .from("billing_orders")
      .select(orderSelect)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);
    assertNoError(result.error, "load organization orders");
    return ((result.data ?? []) as unknown as OrderRow[]).map(mapOrder);
  }

  private async loadPrimaryPairs(organizationIds: string[]) {
    if (organizationIds.length === 0) {
      return new Set<string>();
    }
    const result = await this.client
      .from("organization_primary_accounts")
      .select("organization_id, user_id")
      .in("organization_id", organizationIds);
    assertNoError(result.error, "load primary accounts");
    return new Set(
      (result.data ?? []).map(
        (row) => `${row.organization_id as string}:${row.user_id as string}`,
      ),
    );
  }

  private async searchOrganizationIds(search: string) {
    const pattern = `%${escapePostgrestLike(search)}%`;
    const result = await this.client
      .from("organizations")
      .select("id")
      .or(
        `name.ilike.${quotePostgrestValue(pattern)},code.ilike.${quotePostgrestValue(pattern)}`,
      )
      .limit(10000);
    assertNoError(result.error, "search organizations");
    return (result.data ?? []).map((row) => row.id as string);
  }
}

const organizationSelect = `
  id,
  name,
  code,
  lifecycle_status,
  created_at,
  updated_at,
  organization_primary_accounts(
    user_id,
    assignment_source,
    confirmed_at,
    profiles!organization_primary_accounts_user_id_fkey(email, full_name)
  ),
  organization_members(count),
  organization_subscriptions(
    id,
    status,
    billing_cycle,
    current_period_start,
    current_period_end,
    updated_at,
    billing_plans(id, code, name)
  )
`;

const orderSelect = `
  id,
  organization_id,
  kind,
  status,
  amount_cents,
  currency,
  billing_cycle,
  provider,
  paid_at,
  created_at,
  updated_at,
  organizations!billing_orders_organization_id_fkey(name),
  billing_plans!billing_orders_plan_id_fkey(name)
`;

type MemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
  profiles: Relation<{ email: string; full_name: string }>;
  organizations: Relation<{ name: string }>;
};

type OrderRow = {
  id: string;
  organization_id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  billing_cycle: string | null;
  provider: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  organizations: Relation<{ name: string }>;
  billing_plans: Relation<{ name: string }>;
};

type AuditRow = {
  id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_organization_id: string | null;
  reason: string | null;
  is_high_risk: boolean;
  result: string;
  error_message: string | null;
  trace_id: string;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  created_at: string;
  profiles: Relation<{ full_name: string }>;
  organizations: Relation<{ name: string }>;
};

type OverviewSubscriptionRow = {
  organization_id: string;
  plan_id: string;
  billing_cycle: string;
  current_period_end: string;
};

type CostModelRow = {
  id: string;
  plan_id: string;
  effective_from: string;
  effective_to: string | null;
  fixed_cost_cents: number;
  per_seat_cost_cents: number;
  per_active_streamer_cost_cents: number;
  metric_unit_costs: Record<string, unknown>;
  reason: string;
  billing_plans: Relation<{ name: string; updated_at: string }>;
};

function mapPrimaryAccount(
  relation: OrganizationRow["organization_primary_accounts"],
): OrganizationPrimaryAccountSource | null {
  const account = firstRelation(relation);
  const profile = firstRelation(account?.profiles ?? null);
  if (!account || !profile) {
    return null;
  }
  return {
    userId: account.user_id,
    email: profile.email,
    name: profile.full_name,
    assignmentSource: account.assignment_source,
    confirmedAt: account.confirmed_at,
  };
}

function mapSubscription(
  relation: OrganizationRow["organization_subscriptions"],
): PlatformSubscriptionDto | null {
  const subscription = firstRelation(relation);
  const plan = firstRelation(subscription?.billing_plans ?? null);
  if (!subscription || !plan) {
    return null;
  }
  return {
    id: subscription.id,
    status: subscription.status,
    billingCycle: subscription.billing_cycle,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    updatedAt: subscription.updated_at,
    plan,
  };
}

function mapMember(row: MemberRow, primaryPairs: Set<string>): PlatformUserDto {
  const profile = firstRelation(row.profiles);
  const organization = firstRelation(row.organizations);
  return {
    membershipId: row.id,
    organizationId: row.organization_id,
    organizationName: organization?.name ?? "未知组织",
    userId: row.user_id,
    email: profile?.email ?? "",
    name: profile?.full_name ?? profile?.email ?? "未命名用户",
    role: row.role,
    status: row.status,
    joinedAt: row.created_at,
    updatedAt: row.updated_at,
    isPrimaryAccount: primaryPairs.has(`${row.organization_id}:${row.user_id}`),
  };
}

function mapOrder(row: OrderRow): PlatformOrderDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: firstRelation(row.organizations)?.name ?? "未知组织",
    kind: row.kind,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    planName: firstRelation(row.billing_plans)?.name ?? null,
    billingCycle: row.billing_cycle,
    provider: row.provider,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: AuditRow): PlatformAuditDto {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: firstRelation(row.profiles)?.full_name ?? "平台管理员",
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    organizationId: row.target_organization_id,
    organizationName: firstRelation(row.organizations)?.name ?? null,
    reason: row.reason,
    isHighRisk: row.is_high_risk,
    result: row.result,
    errorMessage: row.error_message,
    traceId: row.trace_id,
    beforeSummary: summarizeAuditSnapshot(row.before_json),
    afterSummary: summarizeAuditSnapshot(row.after_json),
    createdAt: row.created_at,
  };
}

function summarizeAuditSnapshot(value: Record<string, unknown>) {
  const keys = Object.keys(value ?? {});
  if (keys.length === 0) {
    return "无记录";
  }
  return `已记录 ${keys.length} 个字段：${keys.slice(0, 3).join("、")}`;
}

function numericMetricCosts(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function booleanFeatures(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

function calculateOrganizationCost(
  subscription: SubscriptionCostRow,
  usage: UsageRow[],
  version: CostVersionRow | null,
): PlatformOrganizationCost {
  if (!version) {
    return {
      organizationId: subscription.organization_id,
      costCents: 0,
      complete: false,
    };
  }

  let costCents = version.fixed_cost_cents;
  let complete = true;
  for (const row of usage) {
    if (row.metric === "seat") {
      costCents += row.used_quantity * version.per_seat_cost_cents;
      continue;
    }
    if (row.metric === "active_streamer") {
      costCents += row.used_quantity * version.per_active_streamer_cost_cents;
      continue;
    }
    const unitCost = version.metric_unit_costs[row.metric];
    if (typeof unitCost !== "number" || !Number.isFinite(unitCost)) {
      complete = false;
      continue;
    }
    costCents += row.used_quantity * unitCost;
  }

  return {
    organizationId: subscription.organization_id,
    costCents,
    complete,
  };
}

function pickCostVersion(
  rows: CostVersionRow[],
  planId: string,
  dateKey: string,
) {
  const instant = `${dateKey}T23:59:59.999Z`;
  return (
    rows.find(
      (row) =>
        row.plan_id === planId &&
        row.effective_from <= instant &&
        (row.effective_to === null || row.effective_to > instant),
    ) ?? null
  );
}

function netRevenueByOrganization(transactions: PlatformMetricTransaction[]) {
  const result = new Map<string, number>();
  transactions
    .filter((transaction) => transaction.status === "succeeded")
    .forEach((transaction) => {
      const amount =
        transaction.type === "payment"
          ? transaction.amountCents
          : -transaction.amountCents;
      result.set(
        transaction.organizationId,
        (result.get(transaction.organizationId) ?? 0) + amount,
      );
    });
  return result;
}

function firstRelation<T>(relation: Relation<T>): T | null {
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function pageRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

function periodStartTimestamp(period: ReportingPeriod) {
  return `${period.start}T00:00:00.000Z`;
}

function periodEndTimestamp(period: ReportingPeriod) {
  return `${period.end}T23:59:59.999Z`;
}

function addUtcDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function escapePostgrestLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function quotePostgrestValue(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function assertNoError(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) {
    throw new Error(`Failed to ${operation}: ${error.message}`);
  }
}
