import { describe, expect, it } from "vitest";

import {
  normalizeRecordingLinkInput,
  toStreamerRecordingLinkDto,
} from "./streamer-recording-library";

describe("streamer recording library", () => {
  it("formats recording link rows for the streamer table", () => {
    const dto = toStreamerRecordingLinkDto({
      id: "recording-link-1",
      product: "Game Alpha",
      category: "ARPG",
      recording_url: "https://videos.example.com/game-alpha",
      recording_month: "2026-06",
      status: "submitted",
      submitted_at: "2026-06-03T10:00:00.000Z",
    });

    expect(dto).toEqual({
      id: "recording-link-1",
      product: "Game Alpha",
      category: "ARPG",
      link: "https://videos.example.com/game-alpha",
      month: "2026-06",
      status: "submitted",
      statusLabel: "待审核",
      submittedAt: "2026-06-03T10:00:00.000Z",
    });
  });

  it("validates recording link submissions as URL table rows", () => {
    expect(
      normalizeRecordingLinkInput({
        product: " Game Alpha ",
        category: " ARPG ",
        link: "https://videos.example.com/game-alpha",
        month: "2026-06",
      }),
    ).toEqual({
      product: "Game Alpha",
      category: "ARPG",
      link: "https://videos.example.com/game-alpha",
      month: "2026-06",
    });

    expect(() =>
      normalizeRecordingLinkInput({
        product: "Game Alpha",
        category: "ARPG",
        link: "ftp://videos.example.com/game-alpha",
        month: "2026-06",
      }),
    ).toThrow("Recording link must be an http(s) URL");
    expect(() =>
      normalizeRecordingLinkInput({
        product: "Game Alpha",
        category: "ARPG",
        link: "https://videos.example.com/game-alpha",
        month: "202606",
      }),
    ).toThrow("Recording month must be in YYYY-MM format");
  });
});
