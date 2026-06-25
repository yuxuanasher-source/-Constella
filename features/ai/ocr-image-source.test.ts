import { describe, expect, it, vi } from "vitest";

import { resolveOcrImageInput } from "./ocr-image-source";

describe("resolveOcrImageInput", () => {
  it("keeps inline base64 input", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: { liveReportId: "report-1", imageBase64: "ZmFrZQ==" },
        defaultBucket: "evidence-private",
      }),
    ).resolves.toEqual({ imageBase64: "ZmFrZQ==" });
  });

  it("keeps image URL input", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: {
          liveReportId: "report-1",
          imageUrl: "https://example.com/a.png",
        },
        defaultBucket: "evidence-private",
      }),
    ).resolves.toEqual({ imageUrl: "https://example.com/a.png" });
  });

  it("prefers image URL when both URL and base64 input exist", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: {
          liveReportId: "report-1",
          imageBase64: "ZmFrZQ==",
          imageUrl: "https://example.com/a.png",
        },
        defaultBucket: "evidence-private",
      }),
    ).resolves.toEqual({ imageUrl: "https://example.com/a.png" });
  });

  it("downloads private storage object and converts it to base64", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const download = vi.fn(async () => ({ data: blob, error: null }));
    const from = vi.fn(() => ({ download }));

    const result = await resolveOcrImageInput({
      client: { storage: { from } } as never,
      payload: {
        liveReportId: "report-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
      },
      defaultBucket: "fallback-bucket",
    });

    expect(from).toHaveBeenCalledWith("evidence-private");
    expect(download).toHaveBeenCalledWith(
      "org/report-screenshots/task-1/end.png",
    );
    expect(result).toEqual({ imageBase64: "AQID" });
  });

  it("uses the default bucket when the payload does not specify one", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const download = vi.fn(async () => ({ data: blob, error: null }));
    const from = vi.fn(() => ({ download }));

    const result = await resolveOcrImageInput({
      client: { storage: { from } } as never,
      payload: {
        liveReportId: "report-1",
        imagePath: "org/report-screenshots/task-1/end.png",
      },
      defaultBucket: "fallback-bucket",
    });

    expect(from).toHaveBeenCalledWith("fallback-bucket");
    expect(download).toHaveBeenCalledWith(
      "org/report-screenshots/task-1/end.png",
    );
    expect(result).toEqual({ imageBase64: "AQID" });
  });

  it("reports a missing storage object when download returns no data", async () => {
    const download = vi.fn(async () => ({
      data: null,
      error: new Error("storage object not found"),
    }));
    const from = vi.fn(() => ({ download }));

    await expect(
      resolveOcrImageInput({
        client: { storage: { from } } as never,
        payload: {
          liveReportId: "report-1",
          imageBucket: "evidence-private",
          imagePath: "org/report-screenshots/task-1/missing.png",
        },
        defaultBucket: "fallback-bucket",
      }),
    ).rejects.toThrow("OCR image object was not found");
  });

  it("requires at least one image source", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: { liveReportId: "report-1" },
        defaultBucket: "evidence-private",
      }),
    ).rejects.toThrow("OCR job requires imageBase64, imageUrl, or imagePath");
  });
});
