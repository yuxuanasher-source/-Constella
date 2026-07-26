import type {
  AdmissionActor,
  ApplicationAuditWriter,
  ApplicationNotifier,
  ApplicationRecord,
  ApplicationRepository,
  RecordingSubmissionRecord,
} from "@/features/applications/application-service";
import { submitRecording } from "@/features/applications/application-service";
import { normalizeRecordingStoragePath } from "@/features/storage/recording-path-guard";

export type PublicProjectForRecording = {
  id: string;
  name: string;
  organizationId: string;
  status: string;
  isPublicToStreamers: boolean;
};

export type ProjectRecordingDeliveryRepository = ApplicationRepository & {
  getPublicProjectForRecording(
    projectId: string,
  ): Promise<PublicProjectForRecording | null>;
  getApplicationByProjectAndStreamer(
    projectId: string,
    streamerId: string,
  ): Promise<ApplicationRecord | null>;
};

export type ProjectRecordingDeliveryResult = {
  applicationId: string;
  projectId: string;
  recording: RecordingSubmissionRecord;
  reviewStatusLabel: string;
};

const blockedProjectStatuses = new Set([
  "draft",
  "ended",
  "closed",
  "archived",
]);

export async function submitProjectRecording({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: ProjectRecordingDeliveryRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: {
    projectId: unknown;
    streamerId: string;
    link?: unknown;
    storagePath?: unknown;
    durationSeconds?: number;
  };
}): Promise<ProjectRecordingDeliveryResult> {
  if (actor.role !== "streamer") {
    throw new Error("Only streamers can submit project recordings");
  }

  const storagePath = normalizeRecordingStoragePath(
    input.storagePath,
    actor.organizationId,
  );
  const normalized = normalizeProjectRecordingInput({ ...input, storagePath });
  const project = await repo.getPublicProjectForRecording(normalized.projectId);
  if (
    !project ||
    project.organizationId !== actor.organizationId ||
    !project.isPublicToStreamers ||
    blockedProjectStatuses.has(project.status)
  ) {
    throw new Error("Project is not available for recording delivery");
  }

  const streamer = await repo.getStreamerForAdmission(input.streamerId);
  if (!streamer) {
    throw new Error("Streamer not found");
  }
  if (streamer.riskLevel === "blacklisted") {
    throw new Error("Blacklisted streamers cannot submit project recordings");
  }

  const application =
    (await repo.getApplicationByProjectAndStreamer(project.id, streamer.id)) ??
    (await repo.createApplication({
      organizationId: actor.organizationId,
      projectId: project.id,
      streamerId: streamer.id,
      source: "signup",
      status: "submitted",
    }));

  const recording = await submitRecording({
    repo,
    audit,
    notify,
    actor,
    input: {
      applicationId: application.id,
      externalUrl: normalized.link,
      storagePath: normalized.storagePath,
      durationSeconds: normalized.durationSeconds,
    },
  });

  return {
    applicationId: application.id,
    projectId: project.id,
    recording,
    reviewStatusLabel: "审核中",
  };
}

function normalizeProjectRecordingInput(input: {
  projectId: unknown;
  link?: unknown;
  storagePath?: unknown;
  durationSeconds?: number;
}) {
  if (typeof input.projectId !== "string" || !input.projectId.trim()) {
    throw new Error("projectId is required");
  }

  const link =
    typeof input.link === "string" && input.link.trim()
      ? input.link.trim()
      : undefined;
  const storagePath =
    typeof input.storagePath === "string" && input.storagePath.trim()
      ? input.storagePath.trim()
      : undefined;

  if (!link && !storagePath) {
    throw new Error("Recording submission requires a URL or uploaded file");
  }

  if (link) {
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      throw new Error("Recording link must be an http(s) URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Recording link must be an http(s) URL");
    }
  }

  return {
    projectId: input.projectId.trim(),
    link,
    storagePath,
    durationSeconds: input.durationSeconds,
  };
}
