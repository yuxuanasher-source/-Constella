import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractRecordingAudioFromStorage,
  resolveFfmpegPath,
  type RunCommand,
} from "./recording-audio-extraction";

function fakeStorageClient(bytes: Buffer | null, error: Error | null = null) {
  return {
    storage: {
      from(bucket: string) {
        return {
          download(path: string) {
            void bucket;
            void path;
            if (error) {
              return Promise.resolve({ data: null, error });
            }
            if (!bytes) {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({
              data: new Blob([new Uint8Array(bytes)]),
              error: null,
            });
          },
        };
      },
    },
  } as never;
}

describe("recording audio extraction", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "recording-audio-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("downloads the recording, runs ffmpeg and returns base64 mp3", async () => {
    const commands: Array<{ command: string; args: string[] }> = [];
    const runCommand: RunCommand = async (command, args) => {
      commands.push({ command, args });
      const outputPath = args[args.length - 1];
      await writeFile(outputPath, Buffer.from("fake-mp3-bytes"));
      return { stdout: "", stderr: "" };
    };

    const result = await extractRecordingAudioFromStorage({
      client: fakeStorageClient(Buffer.from("fake-video")),
      bucket: "jy-private",
      storagePath: "recordings/org-1/asset-1/replay.MP4",
      ffmpegPath: "ffmpeg",
      runCommand,
      tempRoot,
    });

    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.audioBase64, "base64").toString("utf8")).toBe(
      "fake-mp3-bytes",
    );
    expect(result.audioBytes).toBe(Buffer.from("fake-mp3-bytes").length);

    expect(commands).toHaveLength(1);
    expect(commands[0].command).toBe("ffmpeg");
    expect(commands[0].args).toContain("-vn");
    expect(commands[0].args[commands[0].args.indexOf("-i") + 1]).toMatch(
      /input\.mp4$/,
    );
    expect(commands[0].args[commands[0].args.length - 1]).toMatch(
      /audio\.mp3$/,
    );
  });

  it("cleans up the temp directory even when ffmpeg fails", async () => {
    let workDirFromArgs = "";
    const runCommand: RunCommand = (command, args) => {
      void command;
      workDirFromArgs = args[args.indexOf("-i") + 1];
      return Promise.reject(new Error("boom"));
    };

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient(Buffer.from("fake-video")),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        tempRoot,
      }),
    ).rejects.toThrow(/ffmpeg audio extraction failed: boom/);

    await expect(stat(workDirFromArgs)).rejects.toThrow();
  });

  it("reports a clear error when the ffmpeg binary is missing", async () => {
    const runCommand: RunCommand = () => {
      const error = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return Promise.reject(error);
    };

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient(Buffer.from("fake-video")),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        ffmpegPath: "/opt/ffmpeg",
        runCommand,
        tempRoot,
      }),
    ).rejects.toThrow(/ffmpeg is not available at "\/opt\/ffmpeg"/);
  });

  it("rejects audio tracks larger than the transcription limit", async () => {
    const runCommand: RunCommand = async (_command, args) => {
      await writeFile(args[args.length - 1], Buffer.alloc(2048));
      return { stdout: "", stderr: "" };
    };

    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient(Buffer.from("fake-video")),
        bucket: "jy-private",
        storagePath: "recordings/replay.mp4",
        runCommand,
        maxAudioBytes: 1024,
        tempRoot,
      }),
    ).rejects.toThrow(/exceeds the 0MB transcription limit/);
  });

  it("throws when the storage object is missing", async () => {
    await expect(
      extractRecordingAudioFromStorage({
        client: fakeStorageClient(null),
        bucket: "jy-private",
        storagePath: "recordings/missing.mp4",
        runCommand: () => Promise.resolve({ stdout: "", stderr: "" }),
        tempRoot,
      }),
    ).rejects.toThrow(/was not found in storage/);
  });

  it("resolves the ffmpeg path from env with a default", () => {
    expect(resolveFfmpegPath({})).toBe("ffmpeg");
    expect(
      resolveFfmpegPath({ RECORDING_AI_FFMPEG_PATH: "/usr/local/bin/ffmpeg" }),
    ).toBe("/usr/local/bin/ffmpeg");
  });
});
