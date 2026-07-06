import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractRecordingAudioFromStorage,
  resolveFfmpegPath,
  resolveFfprobePath,
  type FetchLike,
  type RunCommand,
} from "./recording-audio-extraction";

function fakeStorageClient(
  signedUrl: string | null,
  error: Error | null = null,
) {
  return {
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string, expiresIn: number) {
            void bucket;
            void path;
            void expiresIn;
            if (error) {
              return Promise.resolve({ data: null, error });
            }
            if (!signedUrl) {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({ data: { signedUrl }, error: null });
          },
        };
      },
    },
  } as never;
}

function streamedFetch(
  chunks: Buffer[],
  init: { ok?: boolean; status?: number } = {},
): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new Uint8Array(chunk));
        }
        controller.close();
      },
    });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      body: body as unknown as Response["body"],
    };
  };
  return { fetchImpl, urls };
}

function probeStdout(format: Record<string, string | number>): string {
  return JSON.stringify({ format });
}

describe("recording audio extraction", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "recording-audio-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("streams the recording via signed URL, probes it and returns base64 mp3", async () => {
    const commands: Array<{ command: string; args: string[] }> = [];
    let streamedInput: Buffer | null = null;
    const runCommand: RunCommand = async (command, args) => {
      commands.push({ command, args });
      if (command === "ffprobe") {
        // 闸门先于 ffmpeg 跑：此刻输入文件必须已流式落盘完成。
        streamedInput = await readFile(args[args.length - 1]);
        return {
          stdout: probeStdout({ duration: "61.5", size: "20" }),
          stderr: "",
        };
      }
      const outputPath = args[args.length - 1];
      await writeFile(outputPath, Buffer.from("fake-mp3-bytes"));
      return { stdout: "", stderr: "" };
    };
    const { fetchImpl, urls } = streamedFetch([
      Buffer.from("fake-"),
      Buffer.from("video-"),
      Buffer.from("chunks"),
    ]);

    const result = await extractRecordingAudioFromStorage({
      client: fakeStorageClient("https://storage.internal/signed/replay.MP4"),
      bucket: "jy-private",
      storagePath: "recordings/org-1/asset-1/replay.MP4",
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      runCommand,
      fetchImpl,
      tempRoot,
    });

    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.audioBase64, "base64").toString("utf8")).toBe(
      "fake-mp3-bytes",
    );
    expect(result.audioBytes).toBe(Buffer.from("fake-mp3-bytes").length);

    expect(urls).toEqual(["https://storage.internal/signed/replay.MP4"]);
    expect(streamedInput).not.toBeNull();
    expect(streamedInput!.toString("utf8")).toBe("fake-video-chunks");

    expect(commands).toHaveLength(2);
    expect(commands[0].command).toBe("ffprobe");
    expect(commands[0].args).toContain("format=duration,size");
    expect(commands[0].args[commands[0].args.length - 1]).toMatch(
      /input\.mp4$/,
    );
    expect(commands[1].command).toBe("ffmpeg");
    expect(commands[1].args).toContain("-vn");
    expect(commands[1].args[commands[1].args.indexOf("-i") + 1]).toMatch(
      /input\.mp4$/,
    );
    expect(commands[1].args[commands[1].args.length - 1]).toMatch(
      /audio\.mp3$/,
    );
  });

  it("rejects recordings longer than the duration limit before running ffmpeg", async () => {
    const commands: string[] = [];
    const runCommand: RunCommand = async (command) => {
      commands.push(command);
      return {
        stdout: probeStdout({ duration: `${16 * 60}`, size: "10" }),
        stderr: "",
      };
    };
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        fetchImpl,
        maxDurationSeconds: 15 * 60,
        tempRoot,
      }),
    ).rejects.toThrow("录屏时长超过 15 分钟上限，无法解析");
    expect(commands).toEqual(["ffprobe"]);
  });

  it("rejects recordings larger than the source size limit", async () => {
    const runCommand: RunCommand = async () => ({
      stdout: probeStdout({ duration: "60", size: `${20 * 1024 * 1024}` }),
      stderr: "",
    });
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        fetchImpl,
        maxSourceBytes: 10 * 1024 * 1024,
        tempRoot,
      }),
    ).rejects.toThrow("录屏文件超过 10MB 大小上限，无法解析");
  });

  it("fails with a clear error when the signed download returns 4xx", async () => {
    const runCommand: RunCommand = () =>
      Promise.reject(new Error("should not run"));
    const { fetchImpl } = streamedFetch([], { ok: false, status: 404 });

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        fetchImpl,
        tempRoot,
      }),
    ).rejects.toThrow("录屏原始文件下载失败（HTTP 404），无法解析");
  });

  it("cleans up the temp directory even when ffmpeg fails", async () => {
    let workDirInput = "";
    const runCommand: RunCommand = (command, args) => {
      if (command === "ffprobe") {
        workDirInput = args[args.length - 1];
        return Promise.resolve({
          stdout: probeStdout({ duration: "60", size: "10" }),
          stderr: "",
        });
      }
      return Promise.reject(new Error("boom"));
    };
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        fetchImpl,
        tempRoot,
      }),
    ).rejects.toThrow(/ffmpeg audio extraction failed: boom/);

    expect(workDirInput).not.toBe("");
    await expect(stat(workDirInput)).rejects.toThrow();
  });

  it("reports a clear error when the ffmpeg binary is missing", async () => {
    const runCommand: RunCommand = (command) => {
      if (command === "ffprobe") {
        return Promise.resolve({
          stdout: probeStdout({ duration: "60", size: "10" }),
          stderr: "",
        });
      }
      const error = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return Promise.reject(error);
    };
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        ffmpegPath: "/opt/ffmpeg",
        runCommand,
        fetchImpl,
        tempRoot,
      }),
    ).rejects.toThrow(/ffmpeg is not available at "\/opt\/ffmpeg"/);
  });

  it("reports a clear error when the ffprobe binary is missing", async () => {
    const runCommand: RunCommand = () => {
      const error = new Error("spawn ffprobe ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return Promise.reject(error);
    };
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        ffprobePath: "/opt/ffprobe",
        runCommand,
        fetchImpl,
        tempRoot,
      }),
    ).rejects.toThrow(/ffprobe is not available at "\/opt\/ffprobe"/);
  });

  it("rejects audio tracks larger than the transcription limit", async () => {
    const runCommand: RunCommand = async (command, args) => {
      if (command === "ffprobe") {
        return {
          stdout: probeStdout({ duration: "60", size: "10" }),
          stderr: "",
        };
      }
      await writeFile(args[args.length - 1], Buffer.alloc(2048));
      return { stdout: "", stderr: "" };
    };
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient("https://storage.internal/signed/a.mp4"),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        fetchImpl,
        maxAudioBytes: 1024,
        tempRoot,
      }),
    ).rejects.toThrow(/exceeds the 0MB transcription limit/);
  });

  it("throws when the storage object cannot be signed", async () => {
    const { fetchImpl, urls } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient(null, new Error("Object not found")),
        bucket: "jy-private",
        storagePath: "recordings/missing.mp4",
        runCommand: () => Promise.resolve({ stdout: "", stderr: "" }),
        fetchImpl,
        tempRoot,
      }),
    ).rejects.toThrow(/Object not found/);
    expect(urls).toEqual([]);
  });

  it("throws when the signed URL is missing from the storage response", async () => {
    const { fetchImpl } = streamedFetch([Buffer.from("fake-video")]);

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient(null),
        bucket: "jy-private",
        storagePath: "recordings/missing.mp4",
        runCommand: () => Promise.resolve({ stdout: "", stderr: "" }),
        fetchImpl,
        tempRoot,
      }),
    ).rejects.toThrow(/was not found in storage/);
  });

  it("resolves the ffmpeg and ffprobe paths from env with defaults", () => {
    expect(resolveFfmpegPath({})).toBe("ffmpeg");
    expect(
      resolveFfmpegPath({ RECORDING_AI_FFMPEG_PATH: "/usr/local/bin/ffmpeg" }),
    ).toBe("/usr/local/bin/ffmpeg");
    expect(resolveFfprobePath({})).toBe("ffprobe");
    expect(
      resolveFfprobePath({
        RECORDING_AI_FFPROBE_PATH: "/usr/local/bin/ffprobe",
      }),
    ).toBe("/usr/local/bin/ffprobe");
  });
});
