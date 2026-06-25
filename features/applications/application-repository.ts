import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ApplicationSource,
  ApplicationRecord,
  ApplicationRepository,
  ActiveCollaborationAgreementRecord,
  ProjectAdmissionConfig,
  ProjectStreamerRecord,
  RecordingSubmissionRecord,
  StreamerAdmissionRecord,
} from "./application-service";

type ProjectAdmissionRow = {
  id: string;
  name: string;
  open_signup: boolean;
  allow_direct_invite: boolean;
  force_recording: boolean;
  default_settlement_method: string;
  default_hourly_rate: number;
  default_base_salary: number;
  default_settlement_rule: Record<string, unknown>;
};

type PublicProjectForRecordingRow = {
  id: string;
  name: string;
  organization_id: string;
  status: string;
};

type StreamerAdmissionRow = {
  id: string;
  organization_id: string;
  display_name: string;
  user_id: string | null;
  risk_level: "low" | "medium" | "high";
  cooperation_status: string;
  default_settlement_method: string;
  default_price: number | null;
  default_base_salary: number | null;
  default_cps_rate_bps: number | null;
};

type ApplicationRow = {
  id: string;
  organization_id: string;
  project_id: string;
  streamer_id: string;
  source: ApplicationRecord["source"];
  status: ApplicationRecord["status"];
  decision_reason: string | null;
  collaboration_id: string | null;
  contributor_organization_id: string | null;
};

type RecordingSubmissionRow = {
  id: string;
  application_id: string;
  version: number;
  status: RecordingSubmissionRecord["status"];
  collaboration_id: string | null;
  contributor_organization_id: string | null;
};

type ProjectStreamerRow = {
  id: string;
  project_id: string;
  streamer_id: string;
  status: ProjectStreamerRecord["status"];
  collaboration_id: string | null;
  contributor_organization_id: string | null;
};

type ActiveCollaborationAgreementRow = {
  id: string;
  project_id: string;
  partner_organization_id: string;
  status: "active";
};

const applicationSelect = `
  id,
  organization_id,
  project_id,
  streamer_id,
  source,
  status,
  decision_reason,
  collaboration_id,
  contributor_organization_id
`;

export class SupabaseApplicationRepository implements ApplicationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getProjectAdmissionConfig(
    projectId: string,
  ): Promise<ProjectAdmissionConfig | null> {
    const { data, error } = await this.client
      .from("projects")
      .select(
        "id, name, open_signup, allow_direct_invite, force_recording, default_settlement_method, default_hourly_rate, default_base_salary, default_settlement_rule",
      )
      .eq("id", projectId)
      .maybeSingle<ProjectAdmissionRow>();

    if (error) {
      throw error;
    }

    return data ? toProjectAdmissionConfig(data) : null;
  }

  async getPublicProjectForRecording(projectId: string) {
    const { data, error } = await this.client
      .from("streamer_public_project_announcements")
      .select("id, name, organization_id, status")
      .eq("id", projectId)
      .maybeSingle<PublicProjectForRecordingRow>();

    if (error) {
      throw error;
    }

    return data
      ? {
          id: data.id,
          name: data.name,
          organizationId: data.organization_id,
          status: data.status,
          isPublicToStreamers: true,
        }
      : null;
  }

  async getStreamerForAdmission(
    streamerId: string,
  ): Promise<StreamerAdmissionRecord | null> {
    const { data, error } = await this.client
      .from("streamers")
      .select(
        "id, organization_id, display_name, user_id, risk_level, cooperation_status, default_settlement_method, default_price, default_base_salary, default_cps_rate_bps",
      )
      .eq("id", streamerId)
      .maybeSingle<StreamerAdmissionRow>();

    if (error) {
      throw error;
    }

    return data ? toStreamerAdmissionRecord(data) : null;
  }

  async getApplicationById(
    applicationId: string,
  ): Promise<ApplicationRecord | null> {
    const { data, error } = await this.client
      .from("project_applications")
      .select(applicationSelect)
      .eq("id", applicationId)
      .maybeSingle<ApplicationRow>();

    if (error) {
      throw error;
    }

    return data ? toApplicationRecord(data) : null;
  }

  async getApplicationByProjectAndStreamer(
    projectId: string,
    streamerId: string,
    source?: ApplicationSource,
  ): Promise<ApplicationRecord | null> {
    let query = this.client
      .from("project_applications")
      .select(applicationSelect)
      .eq("project_id", projectId)
      .eq("streamer_id", streamerId)
      .order("submitted_at", { ascending: false });

    if (source) {
      query = query.eq("source", source);
    }

    const { data, error } = await query.limit(1).maybeSingle<ApplicationRow>();

    if (error) {
      throw error;
    }

    return data ? toApplicationRecord(data) : null;
  }

  async getActiveCollaborationAgreement(input: {
    projectId: string;
    collaborationId: string;
    contributorOrganizationId: string;
  }): Promise<ActiveCollaborationAgreementRecord | null> {
    const { data, error } = await this.client
      .from("project_collaboration_agreements")
      .select("id, project_id, partner_organization_id, status")
      .eq("id", input.collaborationId)
      .eq("project_id", input.projectId)
      .eq("partner_organization_id", input.contributorOrganizationId)
      .eq("status", "active")
      .maybeSingle<ActiveCollaborationAgreementRow>();

    if (error) {
      throw error;
    }

    return data
      ? {
          id: data.id,
          projectId: data.project_id,
          partnerOrganizationId: data.partner_organization_id,
          status: data.status,
        }
      : null;
  }

  async createApplication(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    source: ApplicationRecord["source"];
    status: ApplicationRecord["status"];
    invitedBy?: string;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<ApplicationRecord> {
    const { data, error } = await this.client
      .from("project_applications")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        source: input.source,
        status: input.status,
        invited_by: input.invitedBy,
        collaboration_id: input.collaborationId,
        contributor_organization_id: input.contributorOrganizationId,
      })
      .select(applicationSelect)
      .single<ApplicationRow>();

    if (error) {
      throw error;
    }

    return toApplicationRecord(data);
  }

  async updateApplicationStatus(
    applicationId: string,
    input: {
      status: ApplicationRecord["status"];
      decidedBy?: string;
      decidedAt?: string;
      decisionReason?: string | null;
    },
  ): Promise<ApplicationRecord> {
    const { data, error } = await this.client
      .from("project_applications")
      .update({
        status: input.status,
        decided_by: input.decidedBy,
        decided_at: input.decidedAt,
        decision_reason: input.decisionReason,
      })
      .eq("id", applicationId)
      .select(applicationSelect)
      .single<ApplicationRow>();

    if (error) {
      throw error;
    }

    return toApplicationRecord(data);
  }

  async markApplicationRecordingReviewing(
    applicationId: string,
  ): Promise<ApplicationRecord> {
    const { data, error } = await this.client
      .rpc("mark_application_recording_reviewing", {
        target_application_id: applicationId,
      })
      .single<ApplicationRow>();

    if (error) {
      throw error;
    }

    return toApplicationRecord(data);
  }

  async createRecordingSubmission(input: {
    organizationId: string;
    applicationId: string;
    projectId: string;
    streamerId: string;
    version: number;
    storagePath?: string;
    externalUrl?: string;
    durationSeconds?: number;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<RecordingSubmissionRecord> {
    const { data, error } = await this.client
      .from("recording_submissions")
      .insert({
        organization_id: input.organizationId,
        application_id: input.applicationId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        version: input.version,
        storage_path: input.storagePath,
        external_url: input.externalUrl,
        duration_seconds: input.durationSeconds,
        collaboration_id: input.collaborationId,
        contributor_organization_id: input.contributorOrganizationId,
      })
      .select(
        "id, application_id, version, status, collaboration_id, contributor_organization_id",
      )
      .single<RecordingSubmissionRow>();

    if (error) {
      throw error;
    }

    return toRecordingSubmissionRecord(data);
  }

  async getLatestRecordingSubmission(
    applicationId: string,
  ): Promise<RecordingSubmissionRecord | null> {
    const { data, error } = await this.client
      .from("recording_submissions")
      .select(
        "id, application_id, version, status, collaboration_id, contributor_organization_id",
      )
      .eq("application_id", applicationId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<RecordingSubmissionRow>();

    if (error) {
      throw error;
    }

    return data ? toRecordingSubmissionRecord(data) : null;
  }

  async updateRecordingReview(
    recordingId: string,
    input: {
      status: RecordingSubmissionRecord["status"];
      reviewedBy: string;
      reviewedAt: string;
      reviewNote?: string;
    },
  ): Promise<RecordingSubmissionRecord> {
    const { data, error } = await this.client
      .from("recording_submissions")
      .update({
        status: input.status,
        reviewed_by: input.reviewedBy,
        reviewed_at: input.reviewedAt,
        review_note: input.reviewNote,
      })
      .eq("id", recordingId)
      .select(
        "id, application_id, version, status, collaboration_id, contributor_organization_id",
      )
      .single<RecordingSubmissionRow>();

    if (error) {
      throw error;
    }

    return toRecordingSubmissionRecord(data);
  }

  async createProjectStreamer(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    status: ProjectStreamerRecord["status"];
    settlementMethod: string;
    hourlyRate: number;
    baseSalary: number;
    cpsRateBps: number;
    settlementRule: Record<string, unknown>;
    createdBy: string;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<ProjectStreamerRecord> {
    const { data, error } = await this.client
      .from("project_streamers")
      .upsert(
        {
          organization_id: input.organizationId,
          project_id: input.projectId,
          streamer_id: input.streamerId,
          status: input.status,
          joined_at: new Date().toISOString(),
          settlement_method: input.settlementMethod,
          hourly_rate: input.hourlyRate,
          base_salary: input.baseSalary,
          cps_rate_bps: input.cpsRateBps,
          settlement_rule: input.settlementRule,
          created_by: input.createdBy,
          collaboration_id: input.collaborationId,
          contributor_organization_id: input.contributorOrganizationId,
        },
        { onConflict: "project_id,streamer_id" },
      )
      .select(
        "id, project_id, streamer_id, status, collaboration_id, contributor_organization_id",
      )
      .single<ProjectStreamerRow>();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      projectId: data.project_id,
      streamerId: data.streamer_id,
      status: data.status,
      collaborationId: data.collaboration_id,
      contributorOrganizationId: data.contributor_organization_id,
    };
  }
}

export async function getStreamerIdForUser(
  client: SupabaseClient,
  userId: string,
  organizationId?: string,
): Promise<string | null> {
  let query = client.from("streamers").select("id").eq("user_id", userId);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0]?.id ?? null;
}

function toProjectAdmissionConfig(
  row: ProjectAdmissionRow,
): ProjectAdmissionConfig {
  return {
    id: row.id,
    name: row.name,
    openSignup: row.open_signup,
    allowDirectInvite: row.allow_direct_invite,
    forceRecording: row.force_recording,
    defaultSettlementMethod: row.default_settlement_method,
    defaultHourlyRate: row.default_hourly_rate,
    defaultBaseSalary: row.default_base_salary,
    defaultSettlementRule: row.default_settlement_rule,
  };
}

function toStreamerAdmissionRecord(
  row: StreamerAdmissionRow,
): StreamerAdmissionRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    organizationId: row.organization_id,
    userId: row.user_id,
    riskLevel:
      row.cooperation_status === "blacklisted" ? "blacklisted" : row.risk_level,
    defaultSettlementMethod: row.default_settlement_method,
    defaultHourlyRate: Number(row.default_price ?? 0),
    defaultBaseSalary: Number(row.default_base_salary ?? 0),
    defaultCpsRateBps: Number(row.default_cps_rate_bps ?? 0),
  };
}

function toApplicationRecord(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    source: row.source,
    status: row.status,
    decisionReason: row.decision_reason,
    collaborationId: row.collaboration_id,
    contributorOrganizationId: row.contributor_organization_id,
  };
}

function toRecordingSubmissionRecord(
  row: RecordingSubmissionRow,
): RecordingSubmissionRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    version: row.version,
    status: row.status,
    collaborationId: row.collaboration_id,
    contributorOrganizationId: row.contributor_organization_id,
  };
}
