import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

// 录屏音频抽取：从私有存储下载录屏原始文件，用 ffmpeg 抽出单声道低码率 mp3，
// 供豆包 ASR 转写。只支持 storage_object 来源；B 站 / 外部链接不在本环节处理
// （不代理、不抓取外部视频流），调用方应回退到确定性草稿。
// ffmpeg 二进制默认取 PATH 中的 `ffmpeg`，可用 RECORDING_AI_FFMPEG_PATH 覆盖。

// 豆包极速版按 base64 直传音频，请求体不能无限大；16kHz 单声道 48kbps 下
// 80MB 约可容纳 3.5 小时直播，超过则明确报错走回退，不做静默截断。
const DEFAULT_MAX_AUDIO_BYTES = 80 * 1024 * 1024;

export type ExtractedRecordingAudio = {
  audioBase64: string;
  format: "mp3";
  audioBytes: number;
};

export type RunCommand = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunCommand: RunCommand = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

export function resolveFfmpegPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RECORDING_AI_FFMPEG_PATH?.trim() || "ffmpeg";
}

export async function extractRecordingAudioFromStorage({
  client,
  bucket,
  storagePath,
  ffmpegPath = resolveFfmpegPath(),
  runCommand = defaultRunCommand,
  maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
  tempRoot = tmpdir(),
}: {
  client: Pick<SupabaseClient, "storage">;
  bucket: string;
  storagePath: string;
  ffmpegPath?: string;
  runCommand?: RunCommand;
  maxAudioBytes?: number;
  tempRoot?: string;
}): Promise<ExtractedRecordingAudio> {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) {
    throw new Error("Recording audio extraction requires a storage path");
  }

  const { data, error } = await client.storage
    .from(bucket)
    .download(normalizedPath);
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Recording object was not found in storage");
  }

  const sourceBytes = Buffer.from(await data.arrayBuffer());
  if (!sourceBytes.length) {
    throw new Error("Recording object is empty");
  }

  const workDir = join(tempRoot, `recording-audio-${randomUUID()}`);
  const inputPath = join(
    workDir,
    `input${normalizeExtension(extname(normalizedPath))}`,
  );
  const outputPath = join(workDir, "audio.mp3");

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(inputPath, sourceBytes);

    try {
      await runCommand(ffmpegPath, [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        "-f",
        "mp3",
        outputPath,
      ]);
    } catch (error) {
      throw new Error(ffmpegErrorSummary(error, ffmpegPath));
    }

    const audioBytes = await readFile(outputPath);
    if (!audioBytes.length) {
      throw new Error("ffmpeg produced an empty audio track");
    }
    if (audioBytes.length > maxAudioBytes) {
      throw new Error(
        `Extracted audio exceeds the ${Math.trunc(maxAudioBytes / (1024 * 1024))}MB transcription limit`,
      );
    }

    return {
      audioBase64: audioBytes.toString("base64"),
      format: "mp3",
      audioBytes: audioBytes.length,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizeExtension(extension: string): string {
  // ffmpeg 依赖扩展名探测容器格式；未知扩展名统一按 mp4 处理。
  return /^\.[A-Za-z0-9]{1,5}$/.test(extension)
    ? extension.toLowerCase()
    : ".mp4";
}

function ffmpegErrorSummary(error: unknown, ffmpegPath: string): string {
  if (
    error &&
    typeof error === "object" &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  ) {
    return `ffmpeg is not available at "${ffmpegPath}" (set RECORDING_AI_FFMPEG_PATH)`;
  }
  const message = error instanceof Error ? error.message : "ffmpeg failed";
  return `ffmpeg audio extraction failed: ${message.slice(0, 300)}`;
}
