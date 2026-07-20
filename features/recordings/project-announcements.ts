import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listLatestRejectionFeedback,
  type StructuredRejectionFeedback,
} from "@/features/admission-review/rejection-feedback";
import type {
  ApplicationStatus,
  RecordingReviewStatus,
} from "@/features/applications/application-state";
import {
  defaultRecordingProductionGuide,
  normalizeRecordingGuideRow,
  type RecordingGuideRow,
  type RecordingProductionGuide,
} from "@/features/recordings/recording-production-guide";

export type StreamerProjectAnnouncementProjectRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  vendor_name: string | null;
  product_name: string | null;
  open_signup: boolean;
  force_recording: boolean;
  public_summary: string;
  game_download_url: string | null;
  published_at: string | null;
  created_at: string;
  project_recording_guides?: RecordingGuideRow | RecordingGuideRow[] | null;
};

export type StreamerProjectAnnouncementApplicationRow = {
  id: string;
  project_id: string;
  status: ApplicationStatus;
  decision_reason: string | null;
  submitted_at: string;
};

export type StreamerProjectAnnouncementRecordingRow = {
  id: string;
  application_id: string;
  version: number;
  status: RecordingReviewStatus;
  duration_seconds: number | null;
  created_at: string;
};

export type StreamerProjectAnnouncementCard = {
  id: string;
  code: string;
  name: string;
  status: string;
  vendor: string;
  product: string;
  publicSummary: string;
  gameDownloadUrl: string | null;
  openSignup: boolean;
  forceRecording: boolean;
  applicationId: string | null;
  applicationStatus: ApplicationStatus | null;
  latestRecordingStatus: RecordingReviewStatus | null;
  latestRecordingVersion: number | null;
  decisionReason: string | null;
  recordingFeedback: string | null;
  recordingGuide: RecordingProductionGuide;
  // 结构化驳回理由（卡点名称 + 单项备注），来自 admission_review 评估。
  rejectionReasons: Array<{ key: string; label: string; note: string | null }>;
  reviewStatusLabel: string;
  canSubmitRecording: boolean;
};

const hiddenProjectStatuses = new Set(["draft", "ended", "closed", "archived"]);
const visibleProjectStatuses = [
  "recruiting",
  "pending_start",
  "active",
  "paused",
];
const recordingSubmittableApplicationStatuses = new Set<ApplicationStatus>([
  "submitted",
  "invited",
  "recording_required",
  "recording_rejected",
]);

export async function listStreamerProjectAnnouncements(
  supabase: SupabaseClient | null,
  input: { organizationId: string; streamerId: string },
): Promise<StreamerProjectAnnouncementCard[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("streamer_public_project_announcements")
    .select(
      "id, code, name, status, vendor_name, product_name, open_signup, force_recording, public_summary, game_download_url, published_at, created_at, project_recording_guides(game_name, game_version, server_region, promotion_goal, target_audience, required_content, required_talking_points, forbidden_content, commercial_actions, technical_standard, template_text, example_url)",
    )
    .eq("organization_id", input.organizationId)
    .in("status", visibleProjectStatuses)
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const projects = (data ?? []) as StreamerProjectAnnouncementProjectRow[];
  const projectIds = projects.map((project) => project.id);
  const applications = await listApplicationsForProjects(supabase, {
    organizationId: input.organizationId,
    streamerId: input.streamerId,
    projectIds,
  });
  const latestRecordings = await listLatestRecordingsForApplications(
    supabase,
    applications.map((application) => application.id),
  );
  const applicationByProject = new Map(
    applications.map((application) => [application.project_id, application]),
  );
  const rejectionFeedback = await listRejectionFeedbackSafely(supabase, {
    organizationId: input.organizationId,
    applicationIds: applications.map((application) => application.id),
  });

  return projects.map((project) => {
    const application = applicationByProject.get(project.id) ?? null;
    const recording = application
      ? (latestRecordings.get(application.id) ?? null)
      : null;

    return toStreamerProjectAnnouncementCard(
      project,
      application,
      recording,
      application ? (rejectionFeedback.get(application.id) ?? null) : null,
    );
  });
}

export async function getStreamerProjectAnnouncement(
  supabase: SupabaseClient | null,
  input: { organizationId: string; streamerId: string; projectId: string },
): Promise<StreamerProjectAnnouncementCard | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("streamer_public_project_announcements")
    .select(
      "id, code, name, status, vendor_name, product_name, open_signup, force_recording, public_summary, game_download_url, published_at, created_at, project_recording_guides(game_name, game_version, server_region, promotion_goal, target_audience, required_content, required_talking_points, forbidden_content, commercial_actions, technical_standard, template_text, example_url)",
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.projectId)
    .in("status", visibleProjectStatuses)
    .maybeSingle<StreamerProjectAnnouncementProjectRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  const applications = await listApplicationsForProjects(supabase, {
    organizationId: input.organizationId,
    streamerId: input.streamerId,
    projectIds: [data.id],
  });
  const application = applications[0] ?? null;
  const latestRecordings = await listLatestRecordingsForApplications(
    supabase,
    application ? [application.id] : [],
  );
  const latestRecording = application
    ? (latestRecordings.get(application.id) ?? null)
    : null;
  const rejectionFeedback = application
    ? await listRejectionFeedbackSafely(supabase, {
        organizationId: input.organizationId,
        applicationIds: [application.id],
      })
    : new Map<string, StructuredRejectionFeedback>();

  return toStreamerProjectAnnouncementCard(
    data,
    application,
    latestRecording,
    application ? (rejectionFeedback.get(application.id) ?? null) : null,
  );
}

// 结构化反馈获取失败不影响公告展示（自由文本 decisionReason 仍在）。
async function listRejectionFeedbackSafely(
  supabase: SupabaseClient,
  input: { organizationId: string; applicationIds: string[] },
): Promise<Map<string, StructuredRejectionFeedback>> {
  try {
    return await listLatestRejectionFeedback({
      client: supabase as never,
      organizationId: input.organizationId,
      applicationIds: input.applicationIds,
    });
  } catch {
    return new Map();
  }
}

export function toStreamerProjectAnnouncementCard(
  project: StreamerProjectAnnouncementProjectRow,
  application: StreamerProjectAnnouncementApplicationRow | null,
  latestRecording: StreamerProjectAnnouncementRecordingRow | null,
  rejectionFeedback?: StructuredRejectionFeedback | null,
): StreamerProjectAnnouncementCard {
  const applicationStatus = application?.status ?? null;
  const guideRow = firstRecordingGuideRow(project.project_recording_guides);
  const recordingGuide =
    normalizeRecordingGuideRow(guideRow) ??
    defaultRecordingProductionGuide({
      product: project.product_name?.trim() || project.name,
      publicSummary: project.public_summary?.trim() || "",
      forceRecording: project.force_recording,
    });

  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    vendor: project.vendor_name?.trim() || "",
    product: project.product_name?.trim() || project.name,
    publicSummary: project.public_summary?.trim() || "",
    gameDownloadUrl: project.game_download_url?.trim() || null,
    openSignup: project.open_signup,
    forceRecording: project.force_recording,
    applicationId: application?.id ?? null,
    applicationStatus,
    latestRecordingStatus: latestRecording?.status ?? null,
    latestRecordingVersion: latestRecording?.version ?? null,
    decisionReason: application?.decision_reason ?? null,
    recordingFeedback: application?.decision_reason?.trim() || null,
    recordingGuide,
    rejectionReasons: rejectionFeedback?.reasons ?? [],
    reviewStatusLabel: reviewStatusLabel(applicationStatus, latestRecording),
    canSubmitRecording:
      !applicationStatus ||
      recordingSubmittableApplicationStatuses.has(applicationStatus),
  };
}

export function isProjectAnnouncementVisibleStatus(status: string): boolean {
  return !hiddenProjectStatuses.has(status);
}

async function listApplicationsForProjects(
  supabase: SupabaseClient,
  input: { organizationId: string; streamerId: string; projectIds: string[] },
): Promise<StreamerProjectAnnouncementApplicationRow[]> {
  if (input.projectIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_applications")
    .select("id, project_id, status, decision_reason, submitted_at")
    .eq("organization_id", input.organizationId)
    .eq("streamer_id", input.streamerId)
    .in("project_id", input.projectIds)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByProject = new Map<
    string,
    StreamerProjectAnnouncementApplicationRow
  >();
  for (const application of (data ??
    []) as StreamerProjectAnnouncementApplicationRow[]) {
    if (!latestByProject.has(application.project_id)) {
      latestByProject.set(application.project_id, application);
    }
  }

  return Array.from(latestByProject.values());
}

async function listLatestRecordingsForApplications(
  supabase: SupabaseClient,
  applicationIds: string[],
): Promise<Map<string, StreamerProjectAnnouncementRecordingRow>> {
  if (applicationIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("recording_submissions")
    .select("id, application_id, version, status, duration_seconds, created_at")
    .in("application_id", applicationIds)
    .order("version", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByApplication = new Map<
    string,
    StreamerProjectAnnouncementRecordingRow
  >();
  for (const recording of (data ??
    []) as StreamerProjectAnnouncementRecordingRow[]) {
    if (!latestByApplication.has(recording.application_id)) {
      latestByApplication.set(recording.application_id, recording);
    }
  }

  return latestByApplication;
}

function reviewStatusLabel(
  applicationStatus: ApplicationStatus | null,
  latestRecording: StreamerProjectAnnouncementRecordingRow | null,
) {
  if (!applicationStatus) return "待投递";
  if (applicationStatus === "recording_reviewing") return "审核中";
  if (applicationStatus === "recording_required") return "需修改";
  if (applicationStatus === "recording_rejected") return "未通过";
  if (applicationStatus === "recording_approved") return "已通过，待确认加入";
  if (applicationStatus === "joined") return "已加入项目";
  if (latestRecording?.status === "submitted") return "审核中";
  if (latestRecording?.status === "reviewing") return "审核中";
  if (latestRecording?.status === "needs_changes") return "需修改";
  if (latestRecording?.status === "rejected") return "未通过";
  if (latestRecording?.status === "approved") return "已通过，待确认加入";
  return "待投递";
}

function firstRecordingGuideRow(
  guide: RecordingGuideRow | RecordingGuideRow[] | null | undefined,
): RecordingGuideRow | null {
  if (!guide) return null;
  return Array.isArray(guide) ? (guide[0] ?? null) : guide;
}
