import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import {
  getRecordingMaxDurationMinutes,
  getRecordingMaxFileBytes,
} from "@/lib/config/env";

// 录屏音频抽取：给私有存储对象签一个下载 URL，把录屏原始文件**流式**写入临时
// 目录（内存占用 O(64KB)，不再整片 Buffer 进内存），先用 ffprobe 做时长/大小
// 闸门，再用 ffmpeg 抽出单声道低码率 mp3，供豆包 ASR 转写。
// 只支持 storage_object 来源；B 站 / 外部链接不在本环节处理（不代理、不抓取
// 外部视频流），调用方应回退到确定性草稿。
// 签名 URL 直接使用 storage-js 返回的原始地址（基于服务端 SUPABASE_URL，
// 内网可达），不做公网 origin 回写——本用途是服务端自取，不给浏览器用。
// ffmpeg / ffprobe 二进制默认取 PATH 中的 `ffmpeg` / `ffprobe`，可分别用
// RECORDING_AI_FFMPEG_PATH / RECORDING_AI_FFPROBE_PATH 覆盖。

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
  options?: { signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>;

export type FetchLike = (
  url: string,
  options?: { signal?: AbortSignal },
) => Promise<Pick<Response, "ok" | "status" | "body">>;

const defaultRunCommand: RunCommand = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: 16 * 1024 * 1024, signal: options?.signal },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

const defaultFetch: FetchLike = (url, options) =>
  fetch(url, { signal: options?.signal });

export function resolveFfmpegPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RECORDING_AI_FFMPEG_PATH?.trim() || "ffmpeg";
}

export function resolveFfprobePath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RECORDING_AI_FFPROBE_PATH?.trim() || "ffprobe";
}

export async function extractRecordingAudioFromStorage({
  client,
  bucket,
  storagePath,
  ffmpegPath = resolveFfmpegPath(),
  ffprobePath = resolveFfprobePath(),
  runCommand = defaultRunCommand,
  fetchImpl = defaultFetch,
  maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
  maxDurationSeconds = getRecordingMaxDurationMinutes() * 60,
  maxSourceBytes = getRecordingMaxFileBytes(),
  tempRoot = tmpdir(),
  signal,
}: {
  client: Pick<SupabaseClient, "storage">;
  bucket: string;
  storagePath: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  runCommand?: RunCommand;
  fetchImpl?: FetchLike;
  maxAudioBytes?: number;
  maxDurationSeconds?: number;
  maxSourceBytes?: number;
  tempRoot?: string;
  signal?: AbortSignal;
}): Promise<ExtractedRecordingAudio> {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) {
    throw new Error("Recording audio extraction requires a storage path");
  }

  const signed = await createSignedDownloadUrl({
    client,
    bucket,
    path: normalizedPath,
    // 服务端拉流：保留内网 origin（SUPABASE_INTERNAL_URL），不绕公网。
    keepInternalOrigin: true,
  });
  if (!signed?.signedUrl) {
    throw new Error("Recording object was not found in storage");
  }

  const workDir = join(tempRoot, `recording-audio-${randomUUID()}`);
  const inputPath = join(
    workDir,
    `input${normalizeExtension(extname(normalizedPath))}`,
  );
  const outputPath = join(workDir, "audio.mp3");

  try {
    throwIfAborted(signal);
    await mkdir(workDir, { recursive: true });

    throwIfAborted(signal);
    const response = await fetchImpl(signed.signedUrl, { signal });
    if (!response.ok) {
      throw new Error(
        `录屏原始文件下载失败（HTTP ${response.status}），无法解析`,
      );
    }
    if (!response.body) {
      throw new Error("录屏原始文件下载失败（响应体为空），无法解析");
    }
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      createWriteStream(inputPath),
      { signal },
    );

    throwIfAborted(signal);
    await assertSourceWithinLimits({
      runCommand,
      ffprobePath,
      inputPath,
      maxDurationSeconds,
      maxSourceBytes,
      signal,
    });

    throwIfAborted(signal);
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
      ], { signal });
    } catch (error) {
      throw new Error(ffmpegErrorSummary(error, ffmpegPath));
    }

    throwIfAborted(signal);
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

// 落盘后、抽音频前的资源闸门：用 ffprobe 读容器时长与文件大小，超限直接抛
// 中文错误，由 runner 的既有降级链路（B6）接住写进 risk_flags/errorSummary。
async function assertSourceWithinLimits({
  runCommand,
  ffprobePath,
  inputPath,
  maxDurationSeconds,
  maxSourceBytes,
  signal,
}: {
  runCommand: RunCommand;
  ffprobePath: string;
  inputPath: string;
  maxDurationSeconds: number;
  maxSourceBytes: number;
  signal?: AbortSignal;
}): Promise<void> {
  let stdout = "";
  try {
    ({ stdout } = await runCommand(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size",
      "-of",
      "json",
      inputPath,
    ], { signal }));
  } catch (error) {
    throw new Error(ffprobeErrorSummary(error, ffprobePath));
  }

  const { duration, size } = parseFfprobeFormat(stdout);
  if (duration !== null && duration > maxDurationSeconds) {
    throw new Error(
      `录屏时长超过 ${formatMinutes(maxDurationSeconds)} 分钟上限，无法解析`,
    );
  }
  if (size !== null && size > maxSourceBytes) {
    throw new Error(
      `录屏文件超过 ${Math.trunc(maxSourceBytes / (1024 * 1024))}MB 大小上限，无法解析`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Recording audio extraction was cancelled", "AbortError");
  }
}

function parseFfprobeFormat(stdout: string): {
  duration: number | null;
  size: number | null;
} {
  // ffprobe 偶发缺字段（部分容器没有 format.duration）；解析不出来的维度
  // 跳过该维度闸门（不误杀），能解析的维度照常拦截。
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { duration: null, size: null };
  }
  const format =
    parsed && typeof parsed === "object"
      ? (parsed as { format?: { duration?: unknown; size?: unknown } }).format
      : null;
  return {
    duration: toFiniteNumber(format?.duration),
    size: toFiniteNumber(format?.size),
  };
}

function toFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMinutes(seconds: number): number {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? minutes : Math.round(minutes * 10) / 10;
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

function ffprobeErrorSummary(error: unknown, ffprobePath: string): string {
  if (
    error &&
    typeof error === "object" &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  ) {
    return `ffprobe is not available at "${ffprobePath}" (set RECORDING_AI_FFPROBE_PATH)`;
  }
  const message = error instanceof Error ? error.message : "ffprobe failed";
  return `ffprobe metadata probe failed: ${message.slice(0, 300)}`;
}
