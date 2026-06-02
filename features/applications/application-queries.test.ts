import { describe, expect, it } from "vitest";

import {
  toOpsApplicationQueueItem,
  toStreamerApplicationCard,
} from "./application-queries";

describe("application query DTO mappers", () => {
  it("maps an operations queue row without exposing settlement fields", () => {
    const dto = toOpsApplicationQueueItem(
      {
        id: "app-1",
        source: "signup",
        status: "recording_reviewing",
        submitted_at: "2026-06-02T01:00:00.000Z",
        decision_reason: null,
        project_id: "project-1",
        streamer_id: "streamer-1",
        projects: { code: "PRJ-1", name: "Launch Project" },
        streamers: {
          display_name: "Streamer One",
          cooperation_status: "active",
          risk_level: "low",
        },
      },
      {
        id: "recording-1",
        application_id: "app-1",
        version: 2,
        status: "submitted",
        duration_seconds: 3600,
        created_at: "2026-06-02T01:10:00.000Z",
      },
    );

    expect(dto).toEqual({
      id: "app-1",
      source: "signup",
      status: "recording_reviewing",
      submittedAt: "2026-06-02T01:00:00.000Z",
      decisionReason: null,
      project: { id: "project-1", code: "PRJ-1", name: "Launch Project" },
      streamer: {
        id: "streamer-1",
        displayName: "Streamer One",
        cooperationStatus: "active",
        riskLevel: "low",
      },
      latestRecording: {
        id: "recording-1",
        version: 2,
        status: "submitted",
        durationSeconds: 3600,
        createdAt: "2026-06-02T01:10:00.000Z",
      },
    });
    expect(JSON.stringify(dto)).not.toContain("settlement");
  });

  it("maps streamer-facing cards to only the streamer's application state", () => {
    const dto = toStreamerApplicationCard(
      {
        id: "app-1",
        source: "direct_invite",
        status: "recording_approved",
        submitted_at: "2026-06-02T01:00:00.000Z",
        decision_reason: "approved",
        project_id: "project-1",
        streamer_id: "streamer-1",
        projects: {
          code: "PRJ-1",
          name: "Launch Project",
          force_recording: true,
        },
      },
      null,
    );

    expect(dto).toEqual({
      id: "app-1",
      source: "direct_invite",
      status: "recording_approved",
      submittedAt: "2026-06-02T01:00:00.000Z",
      decisionReason: "approved",
      project: {
        id: "project-1",
        code: "PRJ-1",
        name: "Launch Project",
        forceRecording: true,
      },
      latestRecording: null,
    });
  });
});
