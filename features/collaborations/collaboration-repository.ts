import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CollaborationRecord,
  CollaborationRepository,
  CollaborationSettlementMode,
  CollaborationStatus,
} from "./collaboration-service";
import type {
  CollaborationLookup,
  CollaborationSubmissionRecord,
  CollaborationSubmissionRepository,
} from "./collaboration-submission-service";
import type { CollaborationSubmissionStatus } from "./collaboration-submission-state";

type CollaborationRow = {
  id: string;
  host_organization_id: string;
  project_id: string;
  partner_organization_id: string | null;
  invite_code: string | null;
  status: CollaborationStatus;
  settlement_mode: CollaborationSettlementMode;
  share_percentage: number | null;
  hourly_fixed_amount: number | null;
};

type SubmissionRow = {
  id: string;
  collaboration_id: string;
  host_organization_id: string;
  partner_organization_id: string;
  project_id: string;
  streamer_name: string;
  live_account: string | null;
  recording_url: string | null;
  note: string | null;
  status: CollaborationSubmissionStatus;
  reviewed_by: string | null;
  review_note: string | null;
  linked_streamer_id: string | null;
  linked_recording_submission_id: string | null;
};

const collaborationSelect =
  "id, host_organization_id, project_id, partner_organization_id, invite_code, status, settlement_mode, share_percentage, hourly_fixed_amount";

const submissionSelect =
  "id, collaboration_id, host_organization_id, partner_organization_id, project_id, streamer_name, live_account, recording_url, note, status, reviewed_by, review_note, linked_streamer_id, linked_recording_submission_id";

export class SupabaseCollaborationRepository
  implements CollaborationRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async createCollaboration(input: {
    hostOrganizationId: string;
    projectId: string;
    inviteCode: string;
    settlementMode: CollaborationSettlementMode;
    sharePercentage: number | null;
    hourlyFixedAmount: number | null;
    invitedBy: string;
  }): Promise<CollaborationRecord> {
    const { data, error } = await this.client
      .from("project_collaborations")
      .insert({
        host_organization_id: input.hostOrganizationId,
        project_id: input.projectId,
        invite_code: input.inviteCode,
        status: "invited",
        settlement_mode: input.settlementMode,
        share_percentage: input.sharePercentage,
        hourly_fixed_amount: input.hourlyFixedAmount,
        invited_by: input.invitedBy,
      })
      .select(collaborationSelect)
      .single<CollaborationRow>();

    if (error) {
      throw error;
    }

    return toCollaborationRecord(data);
  }

  async acceptByInviteCode(input: {
    inviteCode: string;
    partnerOrganizationId: string;
  }): Promise<CollaborationRecord> {
    const { data, error } = await this.client
      .rpc("accept_collaboration", {
        p_invite_code: input.inviteCode,
        p_partner_organization_id: input.partnerOrganizationId,
      })
      .single<CollaborationRow>();

    if (error) {
      throw error;
    }

    return toCollaborationRecord(data);
  }

  async getById(collaborationId: string): Promise<CollaborationRecord | null> {
    const { data, error } = await this.client
      .from("project_collaborations")
      .select(collaborationSelect)
      .eq("id", collaborationId)
      .maybeSingle<CollaborationRow>();

    if (error) {
      throw error;
    }

    return data ? toCollaborationRecord(data) : null;
  }

  async updateCollaboration(
    collaborationId: string,
    patch: Record<string, unknown>,
  ): Promise<CollaborationRecord> {
    const { data, error } = await this.client
      .from("project_collaborations")
      .update(patch)
      .eq("id", collaborationId)
      .select(collaborationSelect)
      .single<CollaborationRow>();

    if (error) {
      throw error;
    }

    return toCollaborationRecord(data);
  }
}

export class SupabaseCollaborationSubmissionRepository
  implements CollaborationSubmissionRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async getCollaboration(
    collaborationId: string,
  ): Promise<CollaborationLookup | null> {
    const { data, error } = await this.client
      .from("project_collaborations")
      .select(
        "id, project_id, host_organization_id, partner_organization_id, status",
      )
      .eq("id", collaborationId)
      .maybeSingle<{
        id: string;
        project_id: string;
        host_organization_id: string;
        partner_organization_id: string | null;
        status: CollaborationLookup["status"];
      }>();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return {
      id: data.id,
      projectId: data.project_id,
      hostOrganizationId: data.host_organization_id,
      partnerOrganizationId: data.partner_organization_id,
      status: data.status,
    };
  }

  async createSubmission(input: {
    collaborationId: string;
    hostOrganizationId: string;
    partnerOrganizationId: string;
    projectId: string;
    streamerName: string;
    liveAccount: string | null;
    recordingUrl: string | null;
    note: string | null;
    submittedBy: string;
  }): Promise<CollaborationSubmissionRecord> {
    const { data, error } = await this.client
      .from("collaboration_submissions")
      .insert({
        collaboration_id: input.collaborationId,
        host_organization_id: input.hostOrganizationId,
        partner_organization_id: input.partnerOrganizationId,
        project_id: input.projectId,
        streamer_name: input.streamerName,
        live_account: input.liveAccount,
        recording_url: input.recordingUrl,
        note: input.note,
        status: "submitted",
        submitted_by: input.submittedBy,
      })
      .select(submissionSelect)
      .single<SubmissionRow>();

    if (error) {
      throw error;
    }

    return toSubmissionRecord(data);
  }

  async getSubmissionById(
    submissionId: string,
  ): Promise<CollaborationSubmissionRecord | null> {
    const { data, error } = await this.client
      .from("collaboration_submissions")
      .select(submissionSelect)
      .eq("id", submissionId)
      .maybeSingle<SubmissionRow>();

    if (error) {
      throw error;
    }

    return data ? toSubmissionRecord(data) : null;
  }

  async updateSubmission(
    submissionId: string,
    patch: Record<string, unknown>,
  ): Promise<CollaborationSubmissionRecord> {
    const { data, error } = await this.client
      .from("collaboration_submissions")
      .update(patch)
      .eq("id", submissionId)
      .select(submissionSelect)
      .single<SubmissionRow>();

    if (error) {
      throw error;
    }

    return toSubmissionRecord(data);
  }

  async landApprovedSubmission(input: {
    submission: CollaborationSubmissionRecord;
    reviewerUserId: string;
  }): Promise<{ streamerId: string; recordingSubmissionId: string | null }> {
    const { submission, reviewerUserId } = input;

    // 1. 按名在甲方组织建档主播，标注 MCN 来源
    const { data: streamer, error: streamerError } = await this.client
      .from("streamers")
      .insert({
        organization_id: submission.hostOrganizationId,
        display_name: submission.streamerName,
        source_type: "supplier_recommended",
        referrer: `MCN:${submission.partnerOrganizationId}`,
        note: `MCN 协作来源（合作方组织 ${submission.partnerOrganizationId}）`,
        created_by: reviewerUserId,
      })
      .select("id")
      .single<{ id: string }>();

    if (streamerError) {
      throw streamerError;
    }

    // 2. 纳入项目主播池，供甲方配班
    const { error: projectStreamerError } = await this.client
      .from("project_streamers")
      .insert({
        organization_id: submission.hostOrganizationId,
        project_id: submission.projectId,
        streamer_id: streamer.id,
        status: "approved",
        created_by: reviewerUserId,
      });

    if (projectStreamerError) {
      throw projectStreamerError;
    }

    // 3. 若带录屏链接，落地为录屏待审核记录（已一审通过）
    let recordingSubmissionId: string | null = null;
    if (submission.recordingUrl) {
      const { data: application, error: applicationError } = await this.client
        .from("project_applications")
        .insert({
          organization_id: submission.hostOrganizationId,
          project_id: submission.projectId,
          streamer_id: streamer.id,
          source: "direct_invite",
          status: "recording_approved",
          invited_by: reviewerUserId,
        })
        .select("id")
        .single<{ id: string }>();

      if (applicationError) {
        throw applicationError;
      }

      const { data: recording, error: recordingError } = await this.client
        .from("recording_submissions")
        .insert({
          organization_id: submission.hostOrganizationId,
          application_id: application.id,
          project_id: submission.projectId,
          streamer_id: streamer.id,
          version: 1,
          external_url: submission.recordingUrl,
          status: "approved",
          reviewed_by: reviewerUserId,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .single<{ id: string }>();

      if (recordingError) {
        throw recordingError;
      }

      recordingSubmissionId = recording.id;
    }

    return { streamerId: streamer.id, recordingSubmissionId };
  }
}

function toCollaborationRecord(row: CollaborationRow): CollaborationRecord {
  return {
    id: row.id,
    hostOrganizationId: row.host_organization_id,
    projectId: row.project_id,
    partnerOrganizationId: row.partner_organization_id,
    inviteCode: row.invite_code,
    status: row.status,
    settlementMode: row.settlement_mode,
    sharePercentage: row.share_percentage,
    hourlyFixedAmount: row.hourly_fixed_amount,
  };
}

function toSubmissionRecord(
  row: SubmissionRow,
): CollaborationSubmissionRecord {
  return {
    id: row.id,
    collaborationId: row.collaboration_id,
    hostOrganizationId: row.host_organization_id,
    partnerOrganizationId: row.partner_organization_id,
    projectId: row.project_id,
    streamerName: row.streamer_name,
    liveAccount: row.live_account,
    recordingUrl: row.recording_url,
    note: row.note,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
    linkedStreamerId: row.linked_streamer_id,
    linkedRecordingSubmissionId: row.linked_recording_submission_id,
  };
}
