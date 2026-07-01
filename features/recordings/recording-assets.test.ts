import { describe, expect, it } from "vitest";

import {
  buildRecordingAssetDraftFromLibraryLink,
  buildRecordingAssetDraftFromSubmission,
  classifyRecordingAssetSource,
  toRecordingAssetDto,
} from "./recording-assets";

describe("recording asset normalization", () => {
  it("classifies Bilibili links as official external preview candidates", () => {
    expect(
      classifyRecordingAssetSource({
        externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      }),
    ).toEqual({
      sourceKind: "bilibili_url",
      previewState: "previewable",
      provider: "bilibili",
      externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      storagePath: undefined,
    });
  });

  it("prefers private storage when a source has an uploaded file", () => {
    expect(
      classifyRecordingAssetSource({
        externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
        storagePath: "recordings/org-1/app-1/v1.mp4",
      }),
    ).toEqual({
      sourceKind: "storage_object",
      previewState: "private_file",
      provider: "private_storage",
      externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      storagePath: "recordings/org-1/app-1/v1.mp4",
    });
  });

  it("builds an asset draft from a project admission recording submission", () => {
    const draft = buildRecordingAssetDraftFromSubmission({
      id: "submission-1",
      organizationId: "org-1",
      applicationId: "app-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      version: 2,
      status: "reviewing",
      externalUrl: "https://b23.tv/BV1xx411c7mD",
      storagePath: null,
      durationSeconds: 618,
      submittedAt: "2026-07-01T08:00:00.000Z",
      createdBy: "user-streamer",
    });

    expect(draft.asset).toMatchObject({
      organizationId: "org-1",
      streamerId: "streamer-1",
      projectId: "project-1",
      applicationId: "app-1",
      assetKind: "project_submission",
      reviewStatus: "reviewing",
      durationSeconds: 618,
      title: "项目录屏 v2",
    });
    expect(draft.source).toMatchObject({
      sourceRef: "recording_submissions:submission-1",
      sourceKind: "bilibili_url",
      provider: "bilibili",
      previewState: "previewable",
      recordingSubmissionId: "submission-1",
    });
  });

  it("builds an asset draft from a streamer recording library link", () => {
    const draft = buildRecordingAssetDraftFromLibraryLink({
      id: "link-1",
      organizationId: "org-1",
      streamerId: "streamer-1",
      product: "Game Alpha",
      category: "ARPG",
      recordingUrl: "https://videos.example.com/game-alpha",
      recordingMonth: "2026-06",
      status: "submitted",
      submittedAt: "2026-07-01T08:10:00.000Z",
      submittedBy: "user-streamer",
    });

    expect(draft.asset).toMatchObject({
      organizationId: "org-1",
      streamerId: "streamer-1",
      projectId: null,
      applicationId: null,
      assetKind: "streamer_library",
      reviewStatus: "submitted",
      title: "Game Alpha · 2026-06",
    });
    expect(draft.asset.metadata).toMatchObject({
      product: "Game Alpha",
      category: "ARPG",
      recordingMonth: "2026-06",
    });
    expect(draft.source).toMatchObject({
      sourceRef: "streamer_recording_links:link-1",
      sourceKind: "external_url",
      streamerRecordingLinkId: "link-1",
      previewState: "external_only",
    });
  });

  it("builds UI preview metadata for Bilibili, external, and private sources", () => {
    const dto = toRecordingAssetDto({
      asset: {
        id: "asset-1",
        title: "项目录屏 v1",
        assetKind: "project_submission",
        reviewStatus: "submitted",
        previewState: "previewable",
        durationSeconds: 600,
        projectId: "project-1",
        applicationId: "application-1",
        createdAt: "2026-07-01T09:00:00.000Z",
        updatedAt: "2026-07-01T09:00:00.000Z",
      },
      sources: [
        {
          id: "source-bili",
          sourceKind: "bilibili_url",
          previewState: "previewable",
          provider: "bilibili",
          externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          storagePath: null,
          submittedAt: "2026-07-01T09:00:00.000Z",
          downloadUrl: null,
        },
        {
          id: "source-external",
          sourceKind: "external_url",
          previewState: "external_only",
          provider: "videos.example.com",
          externalUrl: "https://videos.example.com/raw-recording",
          storagePath: null,
          submittedAt: "2026-07-01T09:01:00.000Z",
          downloadUrl: null,
        },
        {
          id: "source-private",
          sourceKind: "storage_object",
          previewState: "private_file",
          provider: "private_storage",
          externalUrl: null,
          storagePath: "org-1/recordings/project-1/demo.mp4",
          submittedAt: "2026-07-01T09:02:00.000Z",
          downloadUrl: "https://download.local/demo.mp4",
        },
      ],
    });

    expect(dto.primarySource).toMatchObject({
      id: "source-private",
      previewMode: "private_file",
      downloadUrl: "https://download.local/demo.mp4",
    });
    expect(
      dto.sources.find((source) => source.id === "source-bili"),
    ).toMatchObject({
      previewMode: "embed",
      embedUrl:
        "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1&high_quality=1&danmaku=0",
      openUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    });
    expect(
      dto.sources.find((source) => source.id === "source-external"),
    ).toMatchObject({
      previewMode: "external",
      openUrl: "https://videos.example.com/raw-recording",
    });
  });
});
