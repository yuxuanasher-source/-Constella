import type { SupabaseClient } from "@supabase/supabase-js";

import {
  recordingAiAnalysisSelect,
  toRecordingAiAnalysisDto,
  type RecordingAiAnalysisDto,
  type RecordingAiAnalysisRow,
} from "@/features/recordings/recording-ai-analysis";

import type {
  ApplicationStatus,
  RecordingReviewStatus,
} from "./application-state";
import type { ApplicationSource } from "./application-service";

type MaybeArray<T> = T | T[] | null;

export type ApplicationProjectRow = {
  code: string;
  name: string;
  force_recording?: boolean;
};

export type ApplicationStreamerRow = {
  display_name: string;
  cooperation_status: string;
  risk_level: string;
};

export type ApplicationQueueRow = {
  id: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  submitted_at: string;
  decision_reason: string | null;
  project_id: string;
  streamer_id: string;
  projects: MaybeArray<ApplicationProjectRow>;
  streamers?: MaybeArray<ApplicationStreamerRow>;
};

export type RecordingQueueRow = {
  id: string;
  application_id: string;
  asset_id?: string | null;
  version: number;
  status: RecordingReviewStatus;
  duration_seconds: number | null;
  external_url?: string | null;
  storage_path?: string | null;
  created_at: string;
  aiAnalysis?: RecordingAiAnalysisDto | null;
};

export type OpsApplicationQueueItem = {
  id: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  submittedAt: string;
  decisionReason: string | null;
  project: {
    id: string;
    code: string;
    name: string;
  };
  streamer: {
    id: string;
    displayName: string;
    cooperationStatus: string;
    riskLevel: string;
  };
  latestRecording: {
    id: string;
    assetId: string | null;
    version: number;
    status: RecordingReviewStatus;
    durationSeconds: number | null;
    externalUrl: string | null;
    hasPrivateStorage: boolean;
    createdAt: string;
    aiAnalysis: RecordingAiAnalysisDto | null;
  } | null;
};

export type StreamerApplicationCard = {
  id: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  submittedAt: string;
  decisionReason: string | null;
  project: {
    id: string;
    code: string;
    name: string;
    forceRecording: boolean;
  };
  latestRecording: {
    id: string;
    assetId: string | null;
    version: number;
    status: RecordingReviewStatus;
    durationSeconds: number | null;
    externalUrl: string | null;
    hasPrivateStorage: boolean;
    createdAt: string;
    aiAnalysis: RecordingAiAnalysisDto | null;
  } | null;
};

const applicationSelect = `
  id,
  source,
  status,
  submitted_at,
  decision_reason,
  project_id,
  streamer_id,
  projects(code, name, force_recording),
  streamers(display_name, cooperation_status, risk_level)
`;

export async function listOpsApplicationQueue(
  supabase: SupabaseClient | null,
): Promise<OpsApplicationQueueItem[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_applications")
    .select(applicationSelect)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  const applications = (data ?? []) as unknown as ApplicationQueueRow[];
  const latestRecordings = await latestRecordingsByApplication(
    supabase,
    applications.map((application) => application.id),
  );

  return applications.map((application) =>
    toOpsApplicationQueueItem(
      application,
      latestRecordings.get(application.id) ?? null,
    ),
  );
}

export async function listStreamerApplicationCards(
  supabase: SupabaseClient | null,
): Promise<StreamerApplicationCard[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_applications")
    .select(applicationSelect)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  const applications = (data ?? []) as unknown as ApplicationQueueRow[];
  const latestRecordings = await latestRecordingsByApplication(
    supabase,
    applications.map((application) => application.id),
  );

  return applications.map((application) =>
    toStreamerApplicationCard(
      application,
      latestRecordings.get(application.id) ?? null,
    ),
  );
}

export function toOpsApplicationQueueItem(
  row: ApplicationQueueRow,
  latestRecording: RecordingQueueRow | null,
): OpsApplicationQueueItem {
  const project = one(row.projects);
  const streamer = one(row.streamers);

  return {
    id: row.id,
    source: row.source,
    status: row.status,
    submittedAt: row.submitted_at,
    decisionReason: row.decision_reason,
    project: {
      id: row.project_id,
      code: project?.code ?? "",
      name: project?.name ?? "",
    },
    streamer: {
      id: row.streamer_id,
      displayName: streamer?.display_name ?? "",
      cooperationStatus: streamer?.cooperation_status ?? "",
      riskLevel: streamer?.risk_level ?? "",
    },
    latestRecording: toRecordingDto(latestRecording),
  };
}

export function toStreamerApplicationCard(
  row: ApplicationQueueRow,
  latestRecording: RecordingQueueRow | null,
): StreamerApplicationCard {
  const project = one(row.projects);

  return {
    id: row.id,
    source: row.source,
    status: row.status,
    submittedAt: row.submitted_at,
    decisionReason: row.decision_reason,
    project: {
      id: row.project_id,
      code: project?.code ?? "",
      name: project?.name ?? "",
      forceRecording: project?.force_recording ?? true,
    },
    latestRecording: toRecordingDto(latestRecording),
  };
}

async function latestRecordingsByApplication(
  supabase: SupabaseClient,
  applicationIds: string[],
): Promise<Map<string, RecordingQueueRow>> {
  if (applicationIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("recording_submissions")
    .select(
      "id, application_id, asset_id, version, status, duration_seconds, external_url, storage_path, created_at",
    )
    .in("application_id", applicationIds)
    .order("version", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByApplication = new Map<string, RecordingQueueRow>();
  for (const recording of (data ?? []) as RecordingQueueRow[]) {
    if (!latestByApplication.has(recording.application_id)) {
      latestByApplication.set(recording.application_id, recording);
    }
  }

  const latestAnalyses = await latestRecordingAiAnalysesByAsset(
    supabase,
    [...latestByApplication.values()]
      .map((recording) => recording.asset_id)
      .filter((assetId): assetId is string => Boolean(assetId)),
  );
  for (const recording of latestByApplication.values()) {
    recording.aiAnalysis = recording.asset_id
      ? (latestAnalyses.get(recording.asset_id) ?? null)
      : null;
  }

  return latestByApplication;
}

export async function latestRecordingAiAnalysesByAsset(
  supabase: SupabaseClient,
  assetIds: string[],
): Promise<Map<string, RecordingAiAnalysisDto>> {
  if (assetIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("recording_ai_analyses")
    .select(recordingAiAnalysisSelect)
    .in("asset_id", [...new Set(assetIds)])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByAsset = new Map<string, RecordingAiAnalysisDto>();
  for (const row of (data ?? []) as unknown as RecordingAiAnalysisRow[]) {
    if (!latestByAsset.has(row.asset_id)) {
      latestByAsset.set(row.asset_id, toRecordingAiAnalysisDto(row));
    }
  }
  return latestByAsset;
}

function toRecordingDto(recording: RecordingQueueRow | null) {
  if (!recording) {
    return null;
  }

  return {
    id: recording.id,
    assetId: recording.asset_id ?? null,
    version: recording.version,
    status: recording.status,
    durationSeconds: recording.duration_seconds,
    externalUrl: recording.external_url?.trim() || null,
    hasPrivateStorage: Boolean(recording.storage_path?.trim()),
    createdAt: recording.created_at,
    aiAnalysis: recording.aiAnalysis ?? null,
  };
}

function one<T>(value: MaybeArray<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}
