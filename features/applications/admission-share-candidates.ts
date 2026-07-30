import type { SupabaseClient } from "@supabase/supabase-js";

import { RouteError } from "./application-route-utils";
import {
  classifyAdmissionShareSource,
  type AdmissionShareSourceHealth,
} from "./admission-share-workflow";

type McnReviewDecision = "approved" | "rejected" | "needs_changes" | null;
type VendorDecision =
  | "pending"
  | "selected"
  | "backup"
  | "rejected"
  | "needs_changes";

type CandidateRow = {
  id: string;
  application_id: string;
  streamer_id: string;
  version: number;
  storage_path: string | null;
  external_url: string | null;
  mcn_review_decision: McnReviewDecision;
  mcn_reviewed_at: string | null;
  streamer: {
    id: string;
    display_name: string;
    streamer_accounts: Array<{
      account_handle: string;
      is_primary: boolean;
      created_at: string;
    }>;
  } | null;
  vendor_reviews: Array<{
    decision: VendorDecision;
    submitted_at: string;
  }>;
  share_items: Array<{
    created_at: string;
  }>;
};

type PlaybackRow = {
  storage_path: string | null;
  external_url: string | null;
};

export type AdmissionShareCandidateDto = {
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  isLatestVersion: boolean;
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
  };
  mcnReviewDecision: McnReviewDecision;
  mcnReviewedAt: string | null;
  sourceHealth: AdmissionShareSourceHealth;
  hasPrivateStorage: boolean;
  externalUrl: string | null;
  isShareable: boolean;
  blockReason: string | null;
  currentVendorDecision: VendorDecision;
  lastSharedAt: string | null;
};

export interface AdmissionShareCandidateRepository {
  listCandidates(input: {
    organizationId: string;
    projectId: string;
  }): Promise<AdmissionShareCandidateDto[]>;
  getPlaybackSource(input: {
    organizationId: string;
    projectId: string;
    recordingSubmissionId: string;
  }): Promise<
    | { sourceType: "original"; storagePath: string }
    | { sourceType: "external"; url: string }
  >;
}

export class SupabaseAdmissionShareCandidateRepository implements AdmissionShareCandidateRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listCandidates(input: {
    organizationId: string;
    projectId: string;
  }): Promise<AdmissionShareCandidateDto[]> {
    await this.assertProjectOwnership(input);

    const { data, error } = await this.supabase
      .from("recording_submissions")
      .select(
        `
          id,
          application_id,
          streamer_id,
          version,
          storage_path,
          external_url,
          mcn_review_decision,
          mcn_reviewed_at,
          streamer:streamers (
            id,
            display_name,
            streamer_accounts (
              account_handle,
              is_primary,
              created_at
            )
          ),
          vendor_reviews:project_recording_vendor_reviews (
            decision,
            submitted_at
          ),
          share_items:project_recording_share_items (
            created_at
          )
        `,
      )
      .eq("project_id", input.projectId)
      .order("application_id", { ascending: true })
      .order("version", { ascending: false });

    if (error) {
      throw error;
    }

    return toCandidateDtos((data ?? []) as unknown as CandidateRow[]);
  }

  async getPlaybackSource(input: {
    organizationId: string;
    projectId: string;
    recordingSubmissionId: string;
  }): Promise<
    | { sourceType: "original"; storagePath: string }
    | { sourceType: "external"; url: string }
  > {
    await this.assertProjectOwnership(input);

    const { data, error } = await this.supabase
      .from("recording_submissions")
      .select("storage_path, external_url")
      .eq("project_id", input.projectId)
      .eq("id", input.recordingSubmissionId)
      .eq("mcn_review_decision", "approved")
      .maybeSingle<PlaybackRow>();

    if (error) {
      throw error;
    }

    const storagePath = nonEmptyString(data?.storage_path);
    if (storagePath) {
      return { sourceType: "original", storagePath };
    }

    const externalUrl = safeExternalUrl(data?.external_url ?? null);
    if (externalUrl) {
      return { sourceType: "external", url: externalUrl };
    }

    throw new RouteError("Recording not found", 404);
  }

  private async assertProjectOwnership(input: {
    organizationId: string;
    projectId: string;
  }) {
    const { data, error } = await this.supabase
      .from("projects")
      .select("id")
      .eq("id", input.projectId)
      .eq("organization_id", input.organizationId)
      .maybeSingle<{ id: string }>();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new RouteError("Project not found", 404);
    }
  }
}

export async function listAdmissionShareCandidates(
  repo: AdmissionShareCandidateRepository,
  input: {
    organizationId: string;
    projectId: string;
  },
) {
  return repo.listCandidates(input);
}

export async function getAdmissionShareCandidatePlayback(
  repo: AdmissionShareCandidateRepository,
  input: {
    organizationId: string;
    projectId: string;
    recordingSubmissionId: string;
  },
): Promise<
  | { sourceType: "original"; storagePath: string }
  | { sourceType: "external"; url: string }
> {
  return repo.getPlaybackSource(input);
}

function toCandidateDtos(rows: CandidateRow[]): AdmissionShareCandidateDto[] {
  const latestVersions = new Map<string, number>();
  for (const row of rows) {
    latestVersions.set(
      row.application_id,
      Math.max(latestVersions.get(row.application_id) ?? 0, row.version),
    );
  }

  return rows.map((row) => {
    const storagePath = nonEmptyString(row.storage_path);
    const externalUrl = safeExternalUrl(row.external_url);
    const source = classifyAdmissionShareSource(
      storagePath !== null,
      externalUrl,
    );
    const isApproved = row.mcn_review_decision === "approved";
    const isShareable = isApproved && source.status !== "blocked";
    const primaryAccount =
      row.streamer?.streamer_accounts.find((account) => account.is_primary) ??
      row.streamer?.streamer_accounts[0];

    return {
      applicationId: row.application_id,
      recordingSubmissionId: row.id,
      recordingVersion: row.version,
      isLatestVersion:
        row.version === (latestVersions.get(row.application_id) ?? row.version),
      streamer: {
        id: row.streamer?.id ?? row.streamer_id,
        displayName: row.streamer?.display_name ?? "",
        accountLabel:
          primaryAccount?.account_handle ?? row.streamer?.display_name ?? "",
      },
      mcnReviewDecision: row.mcn_review_decision,
      mcnReviewedAt: row.mcn_reviewed_at,
      sourceHealth: source.sourceHealth,
      hasPrivateStorage: storagePath !== null,
      externalUrl,
      isShareable,
      blockReason: isApproved ? source.reasonCode : "MCN_APPROVAL_REQUIRED",
      currentVendorDecision:
        latestByDate(row.vendor_reviews, "submitted_at")?.decision ?? "pending",
      lastSharedAt:
        latestByDate(row.share_items, "created_at")?.created_at ?? null,
    };
  });
}

function latestByDate<T extends Record<K, string>, K extends keyof T>(
  values: T[],
  key: K,
): T | undefined {
  return values.reduce<T | undefined>((latest, value) => {
    if (!latest || value[key] > latest[key]) {
      return value;
    }
    return latest;
  }, undefined);
}

function nonEmptyString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeExternalUrl(value: string | null) {
  const trimmed = nonEmptyString(value);
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
