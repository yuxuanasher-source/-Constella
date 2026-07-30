import type { SupabaseClient } from "@supabase/supabase-js";

import { hashShareSecret } from "./admission-share-board";

type AccessAttemptRow = {
  allowed: boolean;
  retry_after_seconds: number;
};

export class SupabaseAdmissionShareAccessStore {
  constructor(private readonly client: SupabaseClient) {}

  async consumeAttempt(input: {
    shareBoardId: string;
    clientFingerprint: string;
    succeeded: boolean | null;
    now: string;
  }) {
    const { data, error } = await this.client.rpc(
      "consume_admission_share_access_attempt",
      {
        p_share_board_id: input.shareBoardId,
        p_client_fingerprint: input.clientFingerprint,
        p_succeeded: input.succeeded,
        p_now: input.now,
      },
    );
    if (error) {
      throw error;
    }

    const row = (
      Array.isArray(data) ? data[0] : data
    ) as AccessAttemptRow | null;
    if (!row) {
      throw new Error("Admission share access limiter returned no result");
    }

    return {
      allowed: Boolean(row.allowed),
      retryAfterSeconds: Math.max(0, Number(row.retry_after_seconds) || 0),
    };
  }

  async createSession(input: {
    shareBoardId: string;
    sessionToken: string;
    expiresAt: string;
  }) {
    const { error } = await this.client
      .from("project_recording_share_access_sessions")
      .insert({
        share_board_id: input.shareBoardId,
        session_token_hash: hashShareSecret(input.sessionToken),
        expires_at: input.expiresAt,
      });
    if (error) {
      throw error;
    }
  }

  async hasValidSession(input: {
    shareBoardId: string;
    sessionToken: string;
    now: string;
  }) {
    const { data, error } = await this.client
      .from("project_recording_share_access_sessions")
      .select("id")
      .eq("share_board_id", input.shareBoardId)
      .eq("session_token_hash", hashShareSecret(input.sessionToken))
      .gt("expires_at", input.now)
      .maybeSingle<{ id: string }>();
    if (error) {
      throw error;
    }
    return Boolean(data);
  }
}
