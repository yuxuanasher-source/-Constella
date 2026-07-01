import type { RecordingAiAnalysisDto } from "./recording-ai-analysis";

export type RecordingReviewStatus =
  | "submitted"
  | "reviewing"
  | "approved"
  | "rejected"
  | "needs_changes";

export type RecordingAssetKind = "project_submission" | "streamer_library";
export type RecordingAssetSourceKind =
  | "bilibili_url"
  | "external_url"
  | "storage_object";
export type RecordingAssetPreviewState =
  | "pending"
  | "previewable"
  | "external_only"
  | "private_file"
  | "failed";

export type RecordingAssetDraft = {
  asset: {
    organizationId: string;
    streamerId: string;
    projectId: string | null;
    applicationId: string | null;
    assetKind: RecordingAssetKind;
    title: string;
    reviewStatus: RecordingReviewStatus;
    previewState: RecordingAssetPreviewState;
    durationSeconds: number | null;
    metadata: Record<string, unknown>;
    createdBy?: string | null;
  };
  source: {
    organizationId: string;
    sourceRef: string;
    sourceKind: RecordingAssetSourceKind;
    previewState: RecordingAssetPreviewState;
    provider: string;
    externalUrl?: string;
    storagePath?: string;
    recordingSubmissionId?: string;
    streamerRecordingLinkId?: string;
    submittedAt: string;
    metadata: Record<string, unknown>;
  };
};

export type RecordingAssetPreviewMode =
  | "embed"
  | "external"
  | "private_file"
  | "pending";

export type RecordingAssetSourceDto = {
  id: string;
  sourceKind: RecordingAssetSourceKind;
  previewState: RecordingAssetPreviewState;
  previewMode: RecordingAssetPreviewMode;
  provider: string;
  externalUrl: string | null;
  storagePath: string | null;
  openUrl: string | null;
  embedUrl: string | null;
  downloadUrl: string | null;
  submittedAt: string | null;
};

export type RecordingAssetDto = {
  id: string;
  title: string;
  assetKind: RecordingAssetKind;
  reviewStatus: RecordingReviewStatus;
  reviewStatusLabel: string;
  previewState: RecordingAssetPreviewState;
  durationSeconds: number | null;
  projectId: string | null;
  applicationId: string | null;
  createdAt: string;
  updatedAt: string;
  primarySource: RecordingAssetSourceDto | null;
  sources: RecordingAssetSourceDto[];
  aiAnalysis: RecordingAiAnalysisDto | null;
};

export type RecordingAssetDtoInput = {
  asset: {
    id: string;
    title: string;
    assetKind: RecordingAssetKind;
    reviewStatus: RecordingReviewStatus;
    previewState: RecordingAssetPreviewState;
    durationSeconds: number | null;
    projectId: string | null;
    applicationId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sources: Array<{
    id: string;
    sourceKind: RecordingAssetSourceKind;
    previewState: RecordingAssetPreviewState;
    provider: string;
    externalUrl: string | null;
    storagePath: string | null;
    submittedAt: string | null;
    downloadUrl?: string | null;
  }>;
  aiAnalysis?: RecordingAiAnalysisDto | null;
};

const reviewStatusLabels: Record<RecordingReviewStatus, string> = {
  submitted: "待审核",
  reviewing: "审核中",
  approved: "已通过",
  rejected: "已驳回",
  needs_changes: "需修改",
};

const sourcePriority: Record<RecordingAssetSourceKind, number> = {
  storage_object: 3,
  bilibili_url: 2,
  external_url: 1,
};

export function toRecordingAssetDto(
  input: RecordingAssetDtoInput,
): RecordingAssetDto {
  const sources = input.sources
    .map(toRecordingAssetSourceDto)
    .sort(
      (left, right) =>
        sourcePriority[right.sourceKind] - sourcePriority[left.sourceKind] ||
        (right.submittedAt ?? "").localeCompare(left.submittedAt ?? ""),
    );

  return {
    id: input.asset.id,
    title: input.asset.title,
    assetKind: input.asset.assetKind,
    reviewStatus: input.asset.reviewStatus,
    reviewStatusLabel:
      reviewStatusLabels[input.asset.reviewStatus] ?? input.asset.reviewStatus,
    previewState: input.asset.previewState,
    durationSeconds: input.asset.durationSeconds,
    projectId: input.asset.projectId,
    applicationId: input.asset.applicationId,
    createdAt: input.asset.createdAt,
    updatedAt: input.asset.updatedAt,
    primarySource: sources[0] ?? null,
    sources,
    aiAnalysis: input.aiAnalysis ?? null,
  };
}

function toRecordingAssetSourceDto(
  input: RecordingAssetDtoInput["sources"][number],
): RecordingAssetSourceDto {
  const openUrl = input.externalUrl?.trim() || null;
  const embedUrl =
    input.sourceKind === "bilibili_url" && openUrl
      ? buildBilibiliEmbedUrl(openUrl)
      : null;
  const hasPrivateFile =
    input.sourceKind === "storage_object" ||
    input.previewState === "private_file";
  const previewMode: RecordingAssetPreviewMode = hasPrivateFile
    ? "private_file"
    : embedUrl
      ? "embed"
      : openUrl
        ? "external"
        : "pending";

  return {
    id: input.id,
    sourceKind: input.sourceKind,
    previewState: input.previewState,
    previewMode,
    provider: input.provider,
    externalUrl: openUrl,
    storagePath: input.storagePath?.trim() || null,
    openUrl,
    embedUrl,
    downloadUrl: input.downloadUrl?.trim() || null,
    submittedAt: input.submittedAt,
  };
}

export function classifyRecordingAssetSource(input: {
  externalUrl?: string | null;
  storagePath?: string | null;
}): {
  sourceKind: RecordingAssetSourceKind;
  previewState: RecordingAssetPreviewState;
  provider: string;
  externalUrl?: string;
  storagePath?: string;
} {
  const storagePath = optionalTrimmed(input.storagePath);
  const externalUrl = optionalTrimmed(input.externalUrl);

  if (storagePath) {
    return {
      sourceKind: "storage_object",
      previewState: "private_file",
      provider: "private_storage",
      externalUrl,
      storagePath,
    };
  }

  if (!externalUrl) {
    throw new Error("Recording asset source requires a URL or storage path");
  }

  const url = parseHttpUrl(externalUrl);
  if (isBilibiliHost(url.hostname)) {
    return {
      sourceKind: "bilibili_url",
      previewState: "previewable",
      provider: "bilibili",
      externalUrl,
      storagePath: undefined,
    };
  }

  return {
    sourceKind: "external_url",
    previewState: "external_only",
    provider: normalizeProvider(url.hostname),
    externalUrl,
    storagePath: undefined,
  };
}

export function buildRecordingAssetDraftFromSubmission(input: {
  id: string;
  organizationId: string;
  applicationId: string;
  projectId: string;
  streamerId: string;
  version: number;
  status: RecordingReviewStatus;
  externalUrl?: string | null;
  storagePath?: string | null;
  durationSeconds?: number | null;
  submittedAt: string;
  createdBy?: string | null;
  collaborationId?: string | null;
  contributorOrganizationId?: string | null;
}): RecordingAssetDraft {
  const source = classifyRecordingAssetSource({
    externalUrl: input.externalUrl,
    storagePath: input.storagePath,
  });
  const sourceRef = `recording_submissions:${input.id}`;

  return {
    asset: {
      organizationId: input.organizationId,
      streamerId: input.streamerId,
      projectId: input.projectId,
      applicationId: input.applicationId,
      assetKind: "project_submission",
      title: `项目录屏 v${input.version}`,
      reviewStatus: input.status,
      previewState: source.previewState,
      durationSeconds: input.durationSeconds ?? null,
      metadata: {
        sourceRef,
        version: input.version,
        collaborationId: input.collaborationId ?? null,
        contributorOrganizationId: input.contributorOrganizationId ?? null,
      },
      createdBy: input.createdBy ?? null,
    },
    source: {
      organizationId: input.organizationId,
      sourceRef,
      sourceKind: source.sourceKind,
      previewState: source.previewState,
      provider: source.provider,
      externalUrl: source.externalUrl,
      storagePath: source.storagePath,
      recordingSubmissionId: input.id,
      submittedAt: input.submittedAt,
      metadata: {
        version: input.version,
      },
    },
  };
}

export function buildRecordingAssetDraftFromLibraryLink(input: {
  id: string;
  organizationId: string;
  streamerId: string;
  product: string;
  category: string;
  recordingUrl: string;
  recordingMonth: string;
  status: RecordingReviewStatus;
  submittedAt: string;
  submittedBy?: string | null;
}): RecordingAssetDraft {
  const source = classifyRecordingAssetSource({
    externalUrl: input.recordingUrl,
  });
  const sourceRef = `streamer_recording_links:${input.id}`;

  return {
    asset: {
      organizationId: input.organizationId,
      streamerId: input.streamerId,
      projectId: null,
      applicationId: null,
      assetKind: "streamer_library",
      title: `${input.product} · ${input.recordingMonth}`,
      reviewStatus: input.status,
      previewState: source.previewState,
      durationSeconds: null,
      metadata: {
        sourceRef,
        product: input.product,
        category: input.category,
        recordingMonth: input.recordingMonth,
      },
      createdBy: input.submittedBy ?? null,
    },
    source: {
      organizationId: input.organizationId,
      sourceRef,
      sourceKind: source.sourceKind,
      previewState: source.previewState,
      provider: source.provider,
      externalUrl: source.externalUrl,
      storagePath: source.storagePath,
      streamerRecordingLinkId: input.id,
      submittedAt: input.submittedAt,
      metadata: {
        product: input.product,
        category: input.category,
        recordingMonth: input.recordingMonth,
      },
    },
  };
}

function optionalTrimmed(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Recording asset URL must be an http(s) URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Recording asset URL must be an http(s) URL");
  }

  return url;
}

function isBilibiliHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "b23.tv" || normalized.endsWith(".bilibili.com");
}

function normalizeProvider(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function buildBilibiliEmbedUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const bvid = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1];
  if (!bvid) {
    return null;
  }

  const embedUrl = new URL("https://player.bilibili.com/player.html");
  embedUrl.searchParams.set("bvid", bvid);
  embedUrl.searchParams.set("page", "1");
  embedUrl.searchParams.set("high_quality", "1");
  embedUrl.searchParams.set("danmaku", "0");
  return embedUrl.toString();
}
