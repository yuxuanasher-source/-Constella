import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  StreamerCandidateSnapshot,
  StreamerReferenceProject,
} from "@/features/war-room/matching-engine";
import type { StreamerListRow } from "./streamer-queries";
import { toStreamerCardDto } from "./streamer-ui-dto";

// 服务端组装选播候选人快照,替代客户端 POST candidates 数组(信任根收敛,
// 方案 WP1)。指标口径复用主播池卡片(toStreamerCardDto → deriveLivePerformance),
// 与运营看到的主播池数据保持一致;风险标签用 streamers.risk_tags 真实列。
export type CastingCandidateLoadResult = {
  candidates: StreamerCandidateSnapshot[];
  dataGaps: string[];
};

// 与 listStreamerPool 的 select 同源,追加 risk_tags 真实列;显式组织过滤
// 是在 RLS 之上的第二道防线。
const CANDIDATE_SELECT =
  "id, display_name, real_name, gender, source_type, cooperation_status, categories, platforms, styles, default_settlement_method, default_price, default_base_salary, default_cps_rate_bps, risk_level, risk_tags, clean_report_count, created_at, recording_submissions(status, submitted_at), streamer_profile_insights(id, title, summary, strengths, risks, recommendations, tags, source_ref, confirmed_at), live_tasks(status, planned_duration, system_duration, planned_start_at, project_id), live_reports(id, live_task_id, status, settlement_duration, evidence_level, viewers, created_at, project_id, settlement_batch_items!settlement_batch_items_live_report_id_fkey(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status)), settlement_batch_item_reports(settlement_batch_item_id, settlement_batch_items(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status))), streamer_metrics(source_report_id, metric_key, metric_value), projects(default_hourly_rate)), project_streamers(status, project_id, projects(id, code, name, status, default_hourly_rate))";

// 防线:候选池一次最多取 200 人,与 listOpsSettlementBatches 的防线一致。
const CANDIDATE_LIMIT = 200;

const AVAILABILITY_WINDOW_DAYS = 30;

type CandidateRow = StreamerListRow & { risk_tags: string[] | null };

export async function loadCastingCandidates(
  client: SupabaseClient,
  params: {
    organizationId: string;
    requiredMinutes: number;
    candidateIds?: string[];
    now?: string;
  },
): Promise<CastingCandidateLoadResult> {
  let query = client
    .from("streamers")
    .select(CANDIDATE_SELECT)
    .eq("organization_id", params.organizationId)
    .eq(
      "live_reports.settlement_batch_items.organization_id",
      params.organizationId,
    )
    .eq(
      "live_reports.settlement_batch_items.settlement_batches.organization_id",
      params.organizationId,
    )
    .eq(
      "live_reports.settlement_batch_item_reports.organization_id",
      params.organizationId,
    )
    .eq(
      "live_reports.settlement_batch_item_reports.settlement_batch_items.organization_id",
      params.organizationId,
    )
    .eq(
      "live_reports.settlement_batch_item_reports.settlement_batch_items.settlement_batches.organization_id",
      params.organizationId,
    )
    .eq("live_reports.streamer_metrics.organization_id", params.organizationId)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (params.candidateIds?.length) {
    query = query.in("id", params.candidateIds);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as unknown as CandidateRow[];

  const dataGaps = new Set<string>();

  const candidates = rows.map((row) => {
    const card = toStreamerCardDto(row, {
      ...(params.now ? { now: params.now } : {}),
      organizationId: params.organizationId,
    });
    if (card.metrics.screenPass === null) {
      dataGaps.add("candidate_screening_pass_rate");
    }
    if (card.metrics.projectFinish === null) {
      dataGaps.add("candidate_completion_rate");
    }
    if (card.metrics.roi === null) {
      dataGaps.add("candidate_roi");
    }
    if (card.metrics.grossContrib === null) {
      dataGaps.add("candidate_gross_margin_contribution");
    }
    const demonstrated = demonstratedMinutes(row, params.now);
    if (demonstrated === null) {
      dataGaps.add("candidate_availability");
    }

    return {
      id: row.id,
      name: row.display_name,
      categories: row.categories ?? [],
      platforms: row.platforms ?? [],
      styles: row.styles ?? [],
      // metrics.screenPass / projectFinish 是 0-100 百分比 → bps ×100;
      // grossContrib 是元 → 分 ×100。
      completionRateBps:
        card.metrics.projectFinish === null
          ? null
          : Math.round(card.metrics.projectFinish * 100),
      screeningPassRateBps:
        card.metrics.screenPass === null
          ? null
          : Math.round(card.metrics.screenPass * 100),
      // 真实 ROI：归因 GMV / confirmed-or-locked payable 实际结算。
      roiBps:
        card.metrics.roi === null ? null : Math.round(card.metrics.roi * 10000),
      grossMarginContributionCents:
        card.metrics.grossContrib === null
          ? null
          : Math.round(card.metrics.grossContrib * 100),
      riskTags: Array.from(
        new Set([
          ...(row.risk_tags ?? []),
          ...(row.risk_level === "high" ? ["high_risk"] : []),
        ]),
      ),
      // 无结构化排期数据;用近三十天任务时长作为已证明的可排期容量,
      // 查不到时置 requiredMinutes(中性值,不误触 availability_shortage)。
      availableMinutes: demonstrated ?? params.requiredMinutes,
      referenceProjects: referenceProjectsFrom(row),
    };
  });

  return { candidates, dataGaps: Array.from(dataGaps) };
}

function demonstratedMinutes(
  row: CandidateRow,
  nowIso?: string,
): number | null {
  const now = nowIso ? new Date(nowIso) : new Date();
  const cutoff = new Date(
    now.getTime() - AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const minutes = (row.live_tasks ?? [])
    .filter(
      (task) =>
        task.status !== "cancelled" &&
        task.planned_start_at &&
        new Date(task.planned_start_at) >= cutoff,
    )
    .reduce(
      (sum, task) =>
        sum + Math.max(task.system_duration ?? task.planned_duration ?? 0, 0),
      0,
    );

  return minutes > 0 ? minutes : null;
}

function referenceProjectsFrom(row: CandidateRow): StreamerReferenceProject[] {
  return (row.project_streamers ?? [])
    .flatMap((link) => {
      const project = Array.isArray(link.projects)
        ? link.projects[0]
        : link.projects;
      return project
        ? [{ id: project.id, name: project.name, result: project.status }]
        : [];
    })
    .slice(0, 5);
}
