import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ActiveLiveCollaborationAgreementRecord,
  LiveOperationsRepository,
  LiveReportRecord,
  LiveTaskRecord,
  LiveTaskType,
  ProjectStreamerForTask,
  ReportStatus,
} from "./live-operations-service";
import type { EvidenceLevel, TimeSource } from "./live-report-evidence";
import type { LiveTaskStatus } from "./live-task-state";

type ProjectStreamerRow = {
  id: string;
  project_id: string;
  streamer_id: string;
  status: ProjectStreamerForTask["status"];
};

type LiveTaskRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  streamer_id: string;
  title: string;
  task_type: LiveTaskType;
  status: LiveTaskStatus;
  planned_start_at: string | null;
  planned_end_at: string | null;
  planned_duration: number | null;
  requires_timing: boolean;
  system_started_at: string | null;
  system_stopped_at: string | null;
  system_duration: number;
  created_by: string | null;
  collaboration_id: string | null;
  contributor_organization_id: string | null;
};

type LiveReportRow = {
  id: string;
  organization_id: string;
  live_task_id: string;
  project_id: string;
  streamer_id: string;
  status: ReportStatus;
  system_duration: number | null;
  screenshot_duration: number | null;
  claimed_duration: number | null;
  settlement_duration: number | null;
  time_source: TimeSource | null;
  evidence_level: EvidenceLevel | null;
  divergence_pct: number | null;
  viewers: number | null;
  include_in_task_result: boolean;
  enter_settlement_pool: boolean;
  risk_flags: string[];
  collaboration_id: string | null;
  contributor_organization_id: string | null;
};

type CollaborationAgreementRow = {
  id: string;
  project_id: string;
  partner_organization_id: string;
  status: "active";
};

const liveTaskSelect = `
  id,
  organization_id,
  project_id,
  streamer_id,
  title,
  task_type,
  status,
  planned_start_at,
  planned_end_at,
  planned_duration,
  requires_timing,
  system_started_at,
  system_stopped_at,
  system_duration,
  created_by,
  collaboration_id,
  contributor_organization_id
`;

const liveReportSelect = `
  id,
  organization_id,
  live_task_id,
  project_id,
  streamer_id,
  status,
  system_duration,
  screenshot_duration,
  claimed_duration,
  settlement_duration,
  time_source,
  evidence_level,
  divergence_pct,
  viewers,
  include_in_task_result,
  enter_settlement_pool,
  risk_flags,
  collaboration_id,
  contributor_organization_id
`;

export class SupabaseLiveOperationsRepository implements LiveOperationsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getProjectStreamer(input: {
    projectId: string;
    streamerId: string;
  }): Promise<ProjectStreamerForTask | null> {
    const { data, error } = await this.client
      .from("project_streamers")
      .select("id, project_id, streamer_id, status")
      .eq("project_id", input.projectId)
      .eq("streamer_id", input.streamerId)
      .maybeSingle<ProjectStreamerRow>();

    if (error) {
      throw error;
    }

    return data ? toProjectStreamer(data) : null;
  }

  async getActiveCollaborationAgreement(input: {
    projectId: string;
    collaborationId: string;
    contributorOrganizationId: string;
  }): Promise<ActiveLiveCollaborationAgreementRecord | null> {
    const { data, error } = await this.client
      .from("project_collaboration_agreements")
      .select("id, project_id, partner_organization_id, status")
      .eq("id", input.collaborationId)
      .eq("project_id", input.projectId)
      .eq("partner_organization_id", input.contributorOrganizationId)
      .eq("status", "active")
      .maybeSingle<CollaborationAgreementRow>();

    if (error) {
      throw error;
    }

    return data
      ? {
          id: data.id,
          projectId: data.project_id,
          partnerOrganizationId: data.partner_organization_id,
          status: data.status,
        }
      : null;
  }

  async createLiveTask(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    title: string;
    taskType: LiveTaskType;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    plannedDuration?: number | null;
    requiresTiming: boolean;
    createdBy: string;
    note?: string;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<LiveTaskRecord> {
    const { data, error } = await this.client
      .from("live_tasks")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        title: input.title,
        task_type: input.taskType,
        planned_start_at: input.plannedStartAt,
        planned_end_at: input.plannedEndAt,
        planned_duration: input.plannedDuration,
        requires_timing: input.requiresTiming,
        created_by: input.createdBy,
        note: input.note,
        collaboration_id: input.collaborationId,
        contributor_organization_id: input.contributorOrganizationId,
      })
      .select(liveTaskSelect)
      .single<LiveTaskRow>();

    if (error) {
      throw error;
    }

    return toLiveTaskRecord(data);
  }

  async getLiveTaskById(taskId: string): Promise<LiveTaskRecord | null> {
    const { data, error } = await this.client
      .from("live_tasks")
      .select(liveTaskSelect)
      .eq("id", taskId)
      .maybeSingle<LiveTaskRow>();

    if (error) {
      throw error;
    }

    return data ? toLiveTaskRecord(data) : null;
  }

  async updateLiveTask(
    taskId: string,
    patch: Partial<LiveTaskRecord>,
  ): Promise<LiveTaskRecord> {
    const { data, error } = await this.client
      .from("live_tasks")
      .update(toLiveTaskPatch(patch))
      .eq("id", taskId)
      .select(liveTaskSelect)
      .single<LiveTaskRow>();

    if (error) {
      throw error;
    }

    return toLiveTaskRecord(data);
  }

  async createLiveReport(input: {
    organizationId: string;
    liveTaskId: string;
    projectId: string;
    streamerId: string;
    status: ReportStatus;
    systemDuration?: number | null;
    screenshotDuration?: number | null;
    claimedDuration?: number | null;
    settlementDuration: number;
    timeSource: TimeSource;
    evidenceLevel: EvidenceLevel;
    divergencePct?: number | null;
    viewers?: number | null;
    riskFlags: string[];
    createdBy: string;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<LiveReportRecord> {
    const { data, error } = await this.client
      .from("live_reports")
      .insert({
        organization_id: input.organizationId,
        live_task_id: input.liveTaskId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        status: input.status,
        system_duration: input.systemDuration,
        screenshot_duration: input.screenshotDuration,
        claimed_duration: input.claimedDuration,
        settlement_duration: input.settlementDuration,
        time_source: input.timeSource,
        evidence_level: input.evidenceLevel,
        divergence_pct: input.divergencePct,
        viewers: input.viewers,
        risk_flags: input.riskFlags,
        created_by: input.createdBy,
        collaboration_id: input.collaborationId,
        contributor_organization_id: input.contributorOrganizationId,
      })
      .select(liveReportSelect)
      .single<LiveReportRow>();

    if (error) {
      throw error;
    }

    return toLiveReportRecord(data);
  }

  async getLiveReportById(reportId: string): Promise<LiveReportRecord | null> {
    const { data, error } = await this.client
      .from("live_reports")
      .select(liveReportSelect)
      .eq("id", reportId)
      .maybeSingle<LiveReportRow>();

    if (error) {
      throw error;
    }

    return data ? toLiveReportRecord(data) : null;
  }

  async updateLiveReport(
    reportId: string,
    patch: Partial<LiveReportRecord> & {
      reviewedBy?: string;
      reviewedAt?: string;
      reviewNotes?: string;
    },
  ): Promise<LiveReportRecord> {
    const { data, error } = await this.client
      .from("live_reports")
      .update(toLiveReportPatch(patch))
      .eq("id", reportId)
      .select(liveReportSelect)
      .single<LiveReportRow>();

    if (error) {
      throw error;
    }

    return toLiveReportRecord(data);
  }

  async createReportScreenshot(input: {
    organizationId: string;
    liveReportId: string;
    projectId: string;
    streamerId: string;
    storagePath: string;
    fileHash: string;
    uploadedBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.client.from("report_screenshots").insert({
      organization_id: input.organizationId,
      live_report_id: input.liveReportId,
      project_id: input.projectId,
      streamer_id: input.streamerId,
      storage_path: input.storagePath,
      file_hash: input.fileHash,
      uploaded_by: input.uploadedBy,
      metadata: input.metadata ?? {},
    });

    if (error) {
      throw error;
    }
  }

  async createReportChangeLog(input: {
    organizationId: string;
    liveReportId: string;
    changedBy: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changedFields: string[];
    reason?: string;
  }): Promise<void> {
    const { error } = await this.client.from("report_change_logs").insert({
      organization_id: input.organizationId,
      live_report_id: input.liveReportId,
      changed_by: input.changedBy,
      before_json: input.before,
      after_json: input.after,
      changed_fields: input.changedFields,
      reason: input.reason,
    });

    if (error) {
      throw error;
    }
  }
}

export async function getStreamerIdForUser(
  client: SupabaseClient,
  userId: string,
  organizationId?: string,
): Promise<string | null> {
  let query = client.from("streamers").select("id").eq("user_id", userId);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0]?.id ?? null;
}

function toProjectStreamer(row: ProjectStreamerRow): ProjectStreamerForTask {
  return {
    id: row.id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    status: row.status,
  };
}

function toLiveTaskRecord(row: LiveTaskRow): LiveTaskRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    title: row.title,
    taskType: row.task_type,
    status: row.status,
    plannedStartAt: row.planned_start_at,
    plannedEndAt: row.planned_end_at,
    plannedDuration: row.planned_duration,
    requiresTiming: row.requires_timing,
    systemStartedAt: row.system_started_at,
    systemStoppedAt: row.system_stopped_at,
    systemDuration: row.system_duration,
    createdBy: row.created_by,
    collaborationId: row.collaboration_id,
    contributorOrganizationId: row.contributor_organization_id,
  };
}

function toLiveReportRecord(row: LiveReportRow): LiveReportRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    liveTaskId: row.live_task_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    status: row.status,
    systemDuration: row.system_duration,
    screenshotDuration: row.screenshot_duration,
    claimedDuration: row.claimed_duration,
    settlementDuration: row.settlement_duration,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    divergencePct: row.divergence_pct,
    viewers: row.viewers,
    includeInTaskResult: row.include_in_task_result,
    enterSettlementPool: row.enter_settlement_pool,
    riskFlags: row.risk_flags,
    collaborationId: row.collaboration_id,
    contributorOrganizationId: row.contributor_organization_id,
  };
}

function toLiveTaskPatch(
  patch: Partial<LiveTaskRecord>,
): Record<string, unknown> {
  return removeUndefined({
    status: patch.status,
    task_type: patch.taskType,
    planned_start_at: patch.plannedStartAt,
    planned_end_at: patch.plannedEndAt,
    planned_duration: patch.plannedDuration,
    requires_timing: patch.requiresTiming,
    system_started_at: patch.systemStartedAt,
    system_stopped_at: patch.systemStoppedAt,
    system_duration: patch.systemDuration,
    collaboration_id: patch.collaborationId,
    contributor_organization_id: patch.contributorOrganizationId,
  });
}

function toLiveReportPatch(
  patch: Partial<LiveReportRecord> & {
    reviewedBy?: string;
    reviewedAt?: string;
    reviewNotes?: string;
  },
): Record<string, unknown> {
  return removeUndefined({
    status: patch.status,
    system_duration: patch.systemDuration,
    screenshot_duration: patch.screenshotDuration,
    claimed_duration: patch.claimedDuration,
    settlement_duration: patch.settlementDuration,
    time_source: patch.timeSource,
    evidence_level: patch.evidenceLevel,
    divergence_pct: patch.divergencePct,
    viewers: patch.viewers,
    include_in_task_result: patch.includeInTaskResult,
    enter_settlement_pool: patch.enterSettlementPool,
    risk_flags: patch.riskFlags,
    reviewed_by: patch.reviewedBy,
    reviewed_at: patch.reviewedAt,
    review_notes: patch.reviewNotes,
    collaboration_id: patch.collaborationId,
    contributor_organization_id: patch.contributorOrganizationId,
  });
}

function removeUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
