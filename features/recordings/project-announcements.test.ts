import { describe, expect, it } from "vitest";

import {
  isProjectAnnouncementVisibleStatus,
  listStreamerProjectAnnouncements,
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
      recordingFeedback: null,
      recordingGuide: expect.objectContaining({
        gameName: "Game A",
        requiredContent: ["Streamer-facing summary"],
      }),
      rejectionReasons: [],
      reviewStatusLabel: "审核中",
      canSubmitRecording: false,
    });
    expect(dto).not.toHaveProperty("description");
    expect(JSON.stringify(dto)).not.toContain("Ops internal description");
    expect(JSON.stringify(dto)).not.toContain("hourly");
    expect(JSON.stringify(dto)).not.toContain("settlement");
  });

  it("surfaces actionable recording feedback for resubmission states", () => {
    const dto = toStreamerProjectAnnouncementCard(
      {
        id: "project-1",
        code: "PUB-1",
        name: "Public Project",
        status: "recruiting",
        vendor_name: "Vendor A",
        product_name: "Game A",
        open_signup: true,
        force_recording: true,
        public_summary: "Streamer-facing summary",
        game_download_url: "https://download.example.com/game-a",
        published_at: "2026-06-01T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "application-1",
        project_id: "project-1",
        status: "recording_required",
        decision_reason: "Please add gameplay intro.",
        submitted_at: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "recording-1",
        application_id: "application-1",
        version: 2,
        status: "needs_changes",
        duration_seconds: null,
        created_at: "2026-06-02T01:00:00.000Z",
      },
    );

    expect(dto.latestRecordingStatus).toBe("needs_changes");
    expect(dto.recordingFeedback).toBe("Please add gameplay intro.");
    expect(dto.canSubmitRecording).toBe(true);
  });

  it("includes the recording production guide on streamer project cards", async () => {
    const cards = await listStreamerProjectAnnouncements(mockSupabaseWithGuide(), {
      organizationId: "org-1",
      streamerId: "streamer-1",
    });

    expect(cards[0].recordingGuide).toMatchObject({
      gameName: "星海测试服",
      requiredContent: ["新职业", "活动入口"],
      commercialActions: ["展示预约福利入口"],
    });
  });

  it("accepts object-shaped recording guide joins", () => {
    const dto = toStreamerProjectAnnouncementCard(
      projectRowWithGuide(recordingGuideRow()),
      null,
      null,
    );

    expect(dto.recordingGuide).toMatchObject({
      gameName: "星海测试服",
      requiredContent: ["新职业", "活动入口"],
      commercialActions: ["展示预约福利入口"],
    });
  });

  it("falls back to the public project card when guide data is null", () => {
    const dto = toStreamerProjectAnnouncementCard(
      projectRowWithGuide(null),
      null,
      null,
    );

    expect(dto.recordingGuide).toMatchObject({
      gameName: "星海",
      requiredContent: ["Streamer-facing summary"],
      exampleUrl: null,
    });
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

function mockSupabaseWithGuide() {
  return {
    from(table: string) {
      if (table === "streamer_public_project_announcements") {
        return queryResult([
          {
            id: "project-1",
            code: "PUB-1",
            name: "Public Project",
            status: "recruiting",
            vendor_name: "Vendor A",
            product_name: "星海",
            open_signup: true,
            force_recording: true,
            public_summary: "Streamer-facing summary",
            game_download_url: "https://download.example.com/game-a",
            published_at: "2026-06-01T00:00:00.000Z",
            created_at: "2026-06-01T00:00:00.000Z",
            project_recording_guides: [recordingGuideRow()],
          },
        ]);
      }
      if (table === "project_applications") {
        return queryResult([]);
      }
      return queryResult([]);
    },
  } as never;
}

function queryResult(data: unknown[]) {
  const result = {
    data,
    error: null,
  };
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function projectRowWithGuide(
  projectRecordingGuides:
    | ReturnType<typeof recordingGuideRow>
    | ReturnType<typeof recordingGuideRow>[]
    | null,
) {
  return {
    id: "project-1",
    code: "PUB-1",
    name: "Public Project",
    status: "recruiting",
    vendor_name: "Vendor A",
    product_name: "星海",
    open_signup: true,
    force_recording: true,
    public_summary: "Streamer-facing summary",
    game_download_url: "https://download.example.com/game-a",
    published_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
    project_recording_guides: projectRecordingGuides,
  };
}

function recordingGuideRow() {
  return {
    game_name: "星海测试服",
    game_version: "1.2",
    server_region: "安卓一区",
    promotion_goal: "新版本拉新",
    target_audience: "新手玩家",
    required_content: ["新职业", "活动入口"],
    required_talking_points: ["福利领取方式"],
    forbidden_content: ["虚假保底", "攻击竞品"],
    commercial_actions: ["展示预约福利入口"],
    technical_standard: {
      minDurationMinutes: 10,
      orientation: "landscape",
    },
    template_text: "开场说明今天测试新职业。",
    example_url: "https://example.com/demo",
  };
}
