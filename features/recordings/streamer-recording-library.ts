import type { SupabaseClient } from "@supabase/supabase-js";

export type StreamerRecordingLinkStatus =
  | "submitted"
  | "reviewing"
  | "approved"
  | "rejected"
  | "needs_changes";

export type StreamerRecordingLinkRow = {
  id: string;
  product: string;
  category: string;
  recording_url: string;
  recording_month: string;
  status: StreamerRecordingLinkStatus;
  submitted_at: string;
};

export type StreamerRecordingLinkDto = {
  id: string;
  product: string;
  category: string;
  link: string;
  month: string;
  status: StreamerRecordingLinkStatus;
  statusLabel: string;
  submittedAt: string;
};

export type RecordingLinkInput = {
  product: string;
  category: string;
  link: string;
  month: string;
};

const statusLabels: Record<StreamerRecordingLinkStatus, string> = {
  submitted: "待审核",
  reviewing: "审核中",
  approved: "已通过",
  rejected: "已驳回",
  needs_changes: "需修改",
};

export async function listStreamerRecordingLinks(
  supabase: SupabaseClient | null,
  input: { organizationId: string; streamerId: string },
): Promise<StreamerRecordingLinkDto[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("streamer_recording_links")
    .select(
      "id, product, category, recording_url, recording_month, status, submitted_at",
    )
    .eq("organization_id", input.organizationId)
    .eq("streamer_id", input.streamerId)
    .order("recording_month", { ascending: false })
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as StreamerRecordingLinkRow[]).map(
    toStreamerRecordingLinkDto,
  );
}

export async function createStreamerRecordingLink(
  supabase: SupabaseClient | null,
  input: {
    organizationId: string;
    streamerId: string;
    submittedBy: string;
    product: unknown;
    category: unknown;
    link: unknown;
    month: unknown;
  },
): Promise<StreamerRecordingLinkDto> {
  if (!supabase) {
    throw new Error("Supabase client is required");
  }

  const normalized = normalizeRecordingLinkInput(input);
  const { data, error } = await supabase
    .from("streamer_recording_links")
    .insert({
      organization_id: input.organizationId,
      streamer_id: input.streamerId,
      submitted_by: input.submittedBy,
      product: normalized.product,
      category: normalized.category,
      recording_url: normalized.link,
      recording_month: normalized.month,
    })
    .select(
      "id, product, category, recording_url, recording_month, status, submitted_at",
    )
    .single<StreamerRecordingLinkRow>();

  if (error) {
    throw error;
  }

  return toStreamerRecordingLinkDto(data);
}

export function toStreamerRecordingLinkDto(
  row: StreamerRecordingLinkRow,
): StreamerRecordingLinkDto {
  return {
    id: row.id,
    product: row.product,
    category: row.category,
    link: row.recording_url,
    month: row.recording_month,
    status: row.status,
    statusLabel: statusLabels[row.status] ?? row.status,
    submittedAt: row.submitted_at,
  };
}

export function normalizeRecordingLinkInput(
  input: Record<string, unknown>,
): RecordingLinkInput {
  const product = requiredTrimmed(input.product, "product");
  const category = requiredTrimmed(input.category, "category");
  const link = requiredTrimmed(input.link, "link");
  const month = requiredTrimmed(input.month, "month");

  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error("Recording link must be an http(s) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Recording link must be an http(s) URL");
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Recording month must be in YYYY-MM format");
  }

  return {
    product,
    category,
    link,
    month,
  };
}

function requiredTrimmed(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}
