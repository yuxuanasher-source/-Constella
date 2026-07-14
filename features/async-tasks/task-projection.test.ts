import { describe, expect, it } from "vitest";

import { isTerminalTaskStatus } from "./contracts";
import {
  projectOcrTask,
  projectRecordingTask,
  projectSettlementSimulationTask,
} from "./task-projection";

const baseRow = {
  id: "task-1",
  stage: "extract",
  priority: 5,
  attempt: 2,
  max_attempts: 4,
  requested_by: "user-1",
  run_after: "2026-07-14T12:45:00.000Z",
  started_at: "2026-07-14T12:00:00.000Z",
  completed_at: null,
  error_code: null,
  error_message: null,
  created_at: "2026-07-14T11:00:00.000Z",
  updated_at: "2026-07-14T12:30:00.000Z",
};

describe("async task projection", () => {
  it("projects OCR retry rows from live reports without leaking storage paths", () => {
    const dto = projectOcrTask({
      ...baseRow,
      status: "processing",
      payload: {
        liveReportId: "report-123",
        imagePath: "private/ocr/report-123.png",
      },
    });

    expect(dto).toMatchObject({
      id: "task-1",
      type: "ocr",
      status: "running",
      stage: "extract",
      priority: 3,
      attempt: 2,
      maxAttempts: 4,
      requestedBy: "user-1",
      source: { type: "live_report", id: "report-123" },
      nextRunAt: "2026-07-14T12:45:00.000Z",
      queue: null,
      error: null,
    });
    expect(JSON.stringify(dto)).not.toContain("imagePath");
    expect(JSON.stringify(dto)).not.toContain("private/ocr");
  });

  it("normalizes OCR legacy statuses", () => {
    expect(
      projectOcrTask({
        ...baseRow,
        status: "pending",
        payload: { liveReportId: "report-123" },
      }).status,
    ).toBe("queued");
    expect(
      projectOcrTask({
        ...baseRow,
        status: "needs_review",
        payload: { liveReportId: "report-123" },
      }).status,
    ).toBe("needs_confirmation");
  });

  it("rejects OCR rows without a known live report source", () => {
    expect(() =>
      projectOcrTask({
        ...baseRow,
        status: "queued",
        payload: { imagePath: "private/ocr/report-123.png" },
      }),
    ).toThrow(/OCR task source/);
  });

  it("maps recording completed rows to succeeded terminal DTOs", () => {
    const dto = projectRecordingTask({
      ...baseRow,
      status: "completed",
      stage: "summarize",
      payload: { prompt: "summarize the call" },
      asset_id: "asset-7",
      completed_at: "2026-07-14T13:00:00.000Z",
    });

    expect(dto.type).toBe("recording_ai");
    expect(dto.status).toBe("succeeded");
    expect(dto.source).toEqual({ type: "recording_asset", id: "asset-7" });
    expect(isTerminalTaskStatus(dto.status)).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("prompt");
  });

  it("projects settlement simulations without exposing frozen evidence or provider data", () => {
    const dto = projectSettlementSimulationTask({
      ...baseRow,
      id: "settlement-task-1",
      status: "succeeded",
      stage: "simulate",
      payload: {
        draftId: "rule-draft-9",
        frozenEvidence: { screenshots: ["cos://bucket/evidence.png"] },
        providerData: { raw: "large-provider-response" },
      },
      completed_at: "2026-07-14T13:00:00.000Z",
    });

    expect(dto).toMatchObject({
      id: "settlement-task-1",
      type: "settlement_simulation",
      status: "succeeded",
      source: { type: "settlement_rule", id: "rule-draft-9" },
    });
    expect(JSON.stringify(dto)).not.toContain("frozenEvidence");
    expect(JSON.stringify(dto)).not.toContain("providerData");
    expect(JSON.stringify(dto)).not.toContain("cos://bucket");
  });

  it("redacts task errors to code and safe message only", () => {
    const dto = projectOcrTask({
      ...baseRow,
      status: "failed",
      payload: { liveReportId: "report-123" },
      error_code: "OCR_PROVIDER_TIMEOUT",
      error_message: "Provider request failed",
      error: {
        rawResponse: "secret-provider-payload",
        prompt: "extract private details",
      },
    });

    expect(dto.error).toEqual({
      code: "OCR_PROVIDER_TIMEOUT",
      message: "Provider request failed",
    });
    expect(JSON.stringify(dto)).not.toContain("secret-provider-payload");
    expect(JSON.stringify(dto)).not.toContain("extract private details");
  });

  it("projects recording safe error summaries before legacy error messages", () => {
    const dto = projectRecordingTask({
      ...baseRow,
      status: "failed",
      stage: "summarize",
      asset_id: "asset-7",
      error_code: "RECORDING_AI_PROVIDER_TIMEOUT",
      error_summary: "Recording analysis timed out. Please retry.",
      error_message: "Legacy provider failure",
      error: {
        rawResponse: "secret-recording-provider-payload",
      },
    });

    expect(dto.error).toEqual({
      code: "RECORDING_AI_PROVIDER_TIMEOUT",
      message: "Recording analysis timed out. Please retry.",
    });
    expect(JSON.stringify(dto)).not.toContain(
      "secret-recording-provider-payload",
    );
    expect(JSON.stringify(dto)).not.toContain("Legacy provider failure");
  });
});
