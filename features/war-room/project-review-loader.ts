import type { SupabaseClient } from "@supabase/supabase-js";

import { getProjectComplexCostDashboard } from "@/features/complex-cost/complex-cost-queries";
import { summarizeEvidence } from "@/features/settlements/settlement-engine";
import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import type {
  ProjectReviewInput,
  ProjectReviewStreamer,
} from "./project-review-report";

// 服务端组装 ProjectReviewInput,替代客户端 POST 完整财务对象(信任根收敛,
// 方案 WP1)。所有查询显式带 organization_id 过滤,organizationId 只能来自
// getAuthContext;叠加用户会话 client 的 RLS 双保险。查不到项目返回 null
// (路由转 404)。没有真实来源的字段置零/置 unknown 并记入 dataGaps,由路由
// 转成 caveats 呈现——禁止静默编造。
export type ProjectReviewLoadResult = {
  input: ProjectReviewInput;
  dataGaps: string[];
};

type ProjectRow = {
  id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
};

// settlement_batches 金额列是 numeric(12,2) 元;ProjectReviewInput 的
// *Cents 字段是分,换算必须 Math.round 防浮点尾差。
type BatchRow = {
  batch_type: "receivable" | "payable" | string;
  status: string;
  period_start: string;
  period_end: string;
  computed_amount: number | null;
  manual_amount: number | null;
  adjustment_amount: number | null;
};

type ReportRow = {
  streamer_id: string | null;
  status: string | null;
  settlement_duration: number | null;
  viewers: number | null;
  evidence_level: "green" | "yellow" | "red" | null;
  risk_flags: string[] | null;
  streamers:
    | { display_name: string | null }
    | { display_name: string | null }[]
    | null;
};

type TaskRow = {
  streamer_id: string | null;
  status: string | null;
  anomaly_flags: string[] | null;
  streamers:
    | { display_name: string | null }
    | { display_name: string | null }[]
    | null;
};

export async function loadProjectReviewInput(
  client: SupabaseClient,
  params: {
    organizationId: string;
    projectId: string;
    periodStart?: string;
    periodEnd?: string;
    targetMarginBps?: number;
    now?: string;
  },
): Promise<ProjectReviewLoadResult | null> {
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id, name, starts_at, ends_at")
    .eq("organization_id", params.organizationId)
    .eq("id", params.projectId)
    .maybeSingle<ProjectRow>();
  if (projectError) {
    throw projectError;
  }
  if (!project) {
    return null;
  }

  const now = params.now ? new Date(params.now) : new Date();
  const periodStart =
    params.periodStart ?? isoDate(project.starts_at) ?? monthStart(now);
  const periodEnd = params.periodEnd ?? isoDate(project.ends_at) ?? isoDay(now);

  // projects 表没有 category/platform 列;supplier_scores 是无读写的空脚手
  // 架;ROI 与争议记录无真实来源。全部按缺失声明,不推导、不编造。
  const dataGaps = new Set<string>([
    "project_category",
    "project_platform",
    "supplier_quality",
    "streamer_roi",
    "streamer_disputes",
  ]);

  const [batches, reports, tasks, supplierCostCents] = await Promise.all([
    loadBatches(client, params.organizationId, params.projectId),
    loadReports(
      client,
      params.organizationId,
      params.projectId,
      periodStart,
      periodEnd,
    ),
    loadTasks(client, params.organizationId, params.projectId),
    loadSupplierCostCents(
      client,
      params.organizationId,
      params.projectId,
      dataGaps,
    ),
  ]);

  // 期间过滤:批次的 period_start/end 与请求期间有重叠即计入。ISO 日期串
  // 可直接字典序比较。live_reports 用 created_at 过滤(对齐结算池口径),
  // 两者是不同时间轴,复盘期间以此为准。
  const inPeriod = batches.filter(
    (batch) =>
      batch.period_start <= periodEnd && batch.period_end >= periodStart,
  );
  const receivableBatches = inPeriod.filter(
    (batch) => batch.batch_type === "receivable",
  );
  const payableBatches = inPeriod.filter(
    (batch) => batch.batch_type === "payable",
  );

  const receivableCents = toCents(
    sumAmount(receivableBatches, ["computed_amount", "manual_amount"]),
  );
  const manualRevenueCents = toCents(
    sumAmount(receivableBatches, ["manual_amount"]),
  );
  // 应收调整增厚毛利、应付调整侵蚀毛利,符号相消后与复盘引擎的
  // grossMargin = receivable - payable - supplierCost + adjustment 口径一致。
  const adjustmentCents = toCents(
    sumAmount(receivableBatches, ["adjustment_amount"]) -
      sumAmount(payableBatches, ["adjustment_amount"]),
  );

  let payableCents = toCents(
    sumAmount(payableBatches, ["computed_amount", "manual_amount"]),
  );
  if (payableBatches.length === 0) {
    payableCents = await loadPayableEstimateCents(client, {
      organizationId: params.organizationId,
      projectId: params.projectId,
      periodStart,
      periodEnd,
      dataGaps,
    });
  }

  const streamers = aggregateStreamers({
    reports,
    tasks,
    grossMarginCents:
      receivableCents - payableCents - supplierCostCents + adjustmentCents,
  });
  if (streamers.length > 0) {
    dataGaps.add("streamer_margin_allocation");
  }

  const input: ProjectReviewInput = {
    project: {
      id: project.id,
      name: project.name,
      category: "unknown",
      platform: "unknown",
      periodStart,
      periodEnd,
    },
    finance: {
      receivableCents,
      payableCents,
      supplierCostCents,
      adjustmentCents,
      manualRevenueCents,
    },
    streamers,
    suppliers: [],
    evidenceSummary: summarizeEvidence(
      reports.map((report) => ({ evidenceLevel: report.evidence_level })),
    ),
    ...(params.targetMarginBps !== undefined
      ? { targetMarginBps: params.targetMarginBps }
      : {}),
  };

  return { input, dataGaps: Array.from(dataGaps) };
}

async function loadBatches(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<BatchRow[]> {
  const { data, error } = await client
    .from("settlement_batches")
    .select(
      "batch_type, status, period_start, period_end, computed_amount, manual_amount, adjustment_amount",
    )
    .eq("organization_id", organizationId)
    .eq("project_id", projectId)
    .neq("status", "voided");
  if (error) {
    throw error;
  }
  return (data ?? []) as BatchRow[];
}

async function loadReports(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ReportRow[]> {
  const { data, error } = await client
    .from("live_reports")
    .select(
      "streamer_id, status, settlement_duration, viewers, evidence_level, risk_flags, streamers(display_name)",
    )
    .eq("organization_id", organizationId)
    .eq("project_id", projectId)
    .gte("created_at", `${periodStart}T00:00:00.000Z`)
    .lte("created_at", `${periodEnd}T23:59:59.999Z`);
  if (error) {
    throw error;
  }
  return (data ?? []) as ReportRow[];
}

async function loadTasks(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<TaskRow[]> {
  const { data, error } = await client
    .from("live_tasks")
    .select("streamer_id, status, anomaly_flags, streamers(display_name)")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId);
  if (error) {
    throw error;
  }
  return (data ?? []) as TaskRow[];
}

async function loadSupplierCostCents(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
  dataGaps: Set<string>,
): Promise<number> {
  try {
    const dashboard = await getProjectComplexCostDashboard(client, {
      organizationId,
      projectId,
    });
    return Math.max(0, Math.trunc(dashboard.supplierCostCents ?? 0));
  } catch {
    dataGaps.add("supplier_cost_unavailable");
    return 0;
  }
}

async function loadPayableEstimateCents(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
    dataGaps: Set<string>;
  },
): Promise<number> {
  try {
    const pool = await listOpsSettlementPool(client, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    if (pool.length === 0) {
      return 0;
    }
    input.dataGaps.add("payable_from_pool_estimate");
    return toCents(
      pool.reduce((sum, item) => sum + Math.max(item.expectedAmount, 0), 0),
    );
  } catch {
    return 0;
  }
}

function aggregateStreamers({
  reports,
  tasks,
  grossMarginCents,
}: {
  reports: ReportRow[];
  tasks: TaskRow[];
  grossMarginCents: number;
}): ProjectReviewStreamer[] {
  type Accumulator = {
    name: string;
    durationMinutes: number;
    totalViews: number;
    anomalyCount: number;
    finishedTasks: number;
    totalTasks: number;
  };
  const byStreamer = new Map<string, Accumulator>();
  const ensure = (streamerId: string, name: string): Accumulator => {
    const existing = byStreamer.get(streamerId);
    if (existing) {
      if (existing.name === streamerId && name !== streamerId) {
        existing.name = name;
      }
      return existing;
    }
    const created: Accumulator = {
      name,
      durationMinutes: 0,
      totalViews: 0,
      anomalyCount: 0,
      finishedTasks: 0,
      totalTasks: 0,
    };
    byStreamer.set(streamerId, created);
    return created;
  };

  for (const report of reports) {
    if (!report.streamer_id) {
      continue;
    }
    const entry = ensure(
      report.streamer_id,
      displayName(report.streamers) ?? report.streamer_id,
    );
    if (report.status === "approved") {
      entry.durationMinutes += Math.max(report.settlement_duration ?? 0, 0);
      entry.totalViews += Math.max(report.viewers ?? 0, 0);
    }
    if (report.risk_flags?.length) {
      entry.anomalyCount += 1;
    }
  }

  for (const task of tasks) {
    if (!task.streamer_id || task.status === "cancelled") {
      continue;
    }
    const entry = ensure(
      task.streamer_id,
      displayName(task.streamers) ?? task.streamer_id,
    );
    entry.totalTasks += 1;
    if (
      task.status &&
      ["completed", "report_approved", "approved"].includes(task.status)
    ) {
      entry.finishedTasks += 1;
    }
    if (task.status === "abnormal" || task.anomaly_flags?.length) {
      entry.anomalyCount += 1;
    }
  }

  const totalDuration = Array.from(byStreamer.values()).reduce(
    (sum, entry) => sum + entry.durationMinutes,
    0,
  );

  return Array.from(byStreamer.entries()).map(([streamerId, entry]) => ({
    id: streamerId,
    name: entry.name,
    durationMinutes: entry.durationMinutes,
    totalViews: entry.totalViews,
    completionRateBps:
      entry.totalTasks > 0
        ? Math.round((entry.finishedTasks / entry.totalTasks) * 10000)
        : 0,
    // ROI 无真实来源(dataGap: streamer_roi);毛利贡献是按时长分摊的估算
    // 口径(dataGap: streamer_margin_allocation);争议记录无来源(dataGap:
    // streamer_disputes)。
    roiBps: 0,
    grossMarginContributionCents:
      totalDuration > 0
        ? Math.round((grossMarginCents * entry.durationMinutes) / totalDuration)
        : 0,
    anomalyCount: entry.anomalyCount,
    disputeCount: 0,
  }));
}

function sumAmount(rows: BatchRow[], columns: (keyof BatchRow)[]): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      columns.reduce((rowSum, column) => {
        const value = row[column];
        return rowSum + (typeof value === "number" ? value : 0);
      }, 0),
    0,
  );
}

function toCents(yuan: number): number {
  return Math.round(yuan * 100);
}

function displayName(
  relation:
    | { display_name: string | null }
    | { display_name: string | null }[]
    | null,
): string | null {
  const row = Array.isArray(relation) ? relation[0] : relation;
  return row?.display_name ?? null;
}

function isoDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthStart(date: Date): string {
  return `${date.toISOString().slice(0, 7)}-01`;
}
