import { describe, expect, it } from "vitest";

import {
  isProjectAnnouncementVisibleStatus,
  toStreamerProjectAnnouncementCard,
} from "./project-announcements";

describe("streamer project announcements", () => {
  it("maps public project rows with current streamer review state", () => {
    const projectRow = {
      id: "project-1",
      code: "PUB-1",
      name: "Public Project",
      status: "recruiting",
      vendor_name: "Vendor A",
      product_name: "Game A",
      description: "Ops internal description",
      open_signup: true,
      force_recording: true,
      public_summary: "Streamer-facing summary",
      game_download_url: "https://download.example.com/game-a",
      published_at: "2026-06-01T00:00:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
    };
    const dto = toStreamerProjectAnnouncementCard(
      projectRow,
      {
        id: "application-1",
        project_id: "project-1",
        status: "recording_reviewing",
        decision_reason: null,
        submitted_at: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "recording-1",
        application_id: "application-1",
        version: 2,
        status: "submitted",
        duration_seconds: null,
        created_at: "2026-06-02T01:00:00.000Z",
      },
    );

    expect(dto).toEqual({
      id: "project-1",
      code: "PUB-1",
      name: "Public Project",
      status: "recruiting",
      vendor: "Vendor A",
      product: "Game A",
      publicSummary: "Streamer-facing summary",
      gameDownloadUrl: "https://download.example.com/game-a",
      openSignup: true,
      forceRecording: true,
      applicationId: "application-1",
      applicationStatus: "recording_reviewing",
      latestRecordingStatus: "submitted",
      latestRecordingVersion: 2,
      decisionReason: null,
      reviewStatusLabel: "审核中",
      canSubmitRecording: false,
    });
    expect(dto).not.toHaveProperty("description");
    expect(JSON.stringify(dto)).not.toContain("Ops internal description");
    expect(JSON.stringify(dto)).not.toContain("hourly");
    expect(JSON.stringify(dto)).not.toContain("settlement");
  });

  it("excludes draft and finished project statuses from streamer announcements", () => {
    expect(isProjectAnnouncementVisibleStatus("draft")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("ended")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("closed")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("archived")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("recruiting")).toBe(true);
    expect(isProjectAnnouncementVisibleStatus("active")).toBe(true);
  });
});
