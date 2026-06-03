import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateStreamerProfileRepositoryInput,
  StreamerRecord,
  StreamerRepository,
  StreamerRiskLevel,
} from "./streamer-service";

type StreamerRow = {
  id: string;
  display_name: string;
  user_id: string | null;
  risk_level: StreamerRiskLevel;
  cooperation_status: StreamerRecord["cooperationStatus"];
};

const streamerSelect =
  "id, display_name, user_id, risk_level, cooperation_status";

export class SupabaseStreamerRepository implements StreamerRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createProfile(
    input: CreateStreamerProfileRepositoryInput,
  ): Promise<StreamerRecord> {
    const insertPayload: Record<string, unknown> = {
      organization_id: input.organizationId,
      created_by: input.actorUserId,
      display_name: input.displayName,
      user_id: input.userId ?? null,
    };
    if (input.realName !== undefined) {
      insertPayload.real_name = input.realName;
    }
    if (input.gender !== undefined) {
      insertPayload.gender = input.gender;
    }
    if (input.sourceType !== undefined) {
      insertPayload.source_type = input.sourceType;
    }
    if (input.categories !== undefined) {
      insertPayload.categories = input.categories;
    }
    if (input.platforms !== undefined) {
      insertPayload.platforms = input.platforms;
    }
    if (input.styles !== undefined) {
      insertPayload.styles = input.styles;
    }
    if (input.defaultSettlementMethod !== undefined) {
      insertPayload.default_settlement_method = input.defaultSettlementMethod;
    }

    const { data, error } = await this.client
      .from("streamers")
      .insert(insertPayload)
      .select(streamerSelect)
      .single<StreamerRow>();

    if (error) {
      throw error;
    }

    return toStreamerRecord(data);
  }

  async getById(streamerId: string): Promise<StreamerRecord | null> {
    const { data, error } = await this.client
      .from("streamers")
      .select(streamerSelect)
      .eq("id", streamerId)
      .maybeSingle<StreamerRow>();

    if (error) {
      throw error;
    }

    return data ? toStreamerRecord(data) : null;
  }

  async updateRisk(
    streamerId: string,
    input: {
      risk_level: StreamerRiskLevel;
      risk_reason?: string | null;
      blacklist_reason?: string | null;
    },
  ): Promise<StreamerRecord> {
    const { data, error } = await this.client
      .from("streamers")
      .update(input)
      .eq("id", streamerId)
      .select(streamerSelect)
      .single<StreamerRow>();

    if (error) {
      throw error;
    }

    return toStreamerRecord(data);
  }
}

function toStreamerRecord(row: StreamerRow): StreamerRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    userId: row.user_id,
    riskLevel: row.risk_level,
    cooperationStatus: row.cooperation_status,
  };
}
