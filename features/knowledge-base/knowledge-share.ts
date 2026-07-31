import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppRole } from "@/lib/rbac/roles";

export const DEFAULT_KNOWLEDGE_SHARE_EXPIRY_DAYS = 7;
export const ALLOWED_KNOWLEDGE_SHARE_EXPIRY_DAYS = [1, 7, 30] as const;
export const MAX_KNOWLEDGE_SHARE_TITLE_LENGTH = 200;
export const MAX_KNOWLEDGE_SHARE_CONTENT_BYTES = 8 * 1024 * 1024;
export const MAX_KNOWLEDGE_SHARE_SOURCE_ID_LENGTH = 128;
export const MAX_KNOWLEDGE_SHARE_REQUEST_KEY_LENGTH = 128;

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class InvalidKnowledgeShareInputError extends Error {
  constructor() {
    super("Invalid knowledge share input");
    this.name = "InvalidKnowledgeShareInputError";
  }
}

export type KnowledgeShareRequestStatus =
  | "active"
  | "pending"
  | "failed"
  | "revoked"
  | "expired";

export class DuplicateKnowledgeShareRequestError extends Error {
  readonly existingShareId?: string;
  readonly shareStatus?: KnowledgeShareRequestStatus;

  constructor(
    existingShareId?: string,
    shareStatus?: KnowledgeShareRequestStatus,
  ) {
    super("Knowledge share request already processed");
    this.name = "DuplicateKnowledgeShareRequestError";
    this.existingShareId = existingShareId;
    this.shareStatus = shareStatus;
  }
}

export class KnowledgeShareCreationError extends Error {
  constructor() {
    super("Knowledge share creation failed");
    this.name = "KnowledgeShareCreationError";
  }
}

export type KnowledgeShareSnapshot = {
  contentMd: string;
};

export type PublicKnowledgeShare = {
  title: string;
  contentMd: string;
  sharedBy?: string;
  createdAt: string;
  expiresAt: string;
};

export type PendingKnowledgeShare = {
  id: string;
  organizationId: string;
  tokenHash: string;
  title: string;
  sourceDocumentId: string | null;
  cosKey: string;
  requestKey: string;
  createdBy: string;
  createdByName?: string;
  expiresAt: string;
};

export type PublicKnowledgeShareMetadata = {
  title: string;
  cosKey: string;
  createdByName?: string | null;
  createdAt: string;
  expiresAt: string;
};

export type ActiveKnowledgeShare = {
  id: string;
  title: string;
  expiresAt: string;
  createdAt: string;
};

export type RevokedKnowledgeShare = {
  id: string;
  cosKey: string;
  newlyRevoked: boolean;
};

export type KnowledgeShareCompensationStage =
  | "mark_failed"
  | "delete_snapshot";

export type KnowledgeShareCompensationFailure = {
  shareId: string;
  failedStages: KnowledgeShareCompensationStage[];
};

export type KnowledgeShareRepository = {
  insertPending(input: PendingKnowledgeShare): Promise<void>;
  markActive(input: { id: string; organizationId: string }): Promise<boolean>;
  markFailed(input: { id: string; organizationId: string }): Promise<void>;
  findPublicActive(input: {
    tokenHash: string;
    now: string;
  }): Promise<PublicKnowledgeShareMetadata | null>;
  listActive(input: {
    organizationId: string;
    sourceDocumentId?: string;
    now: string;
  }): Promise<ActiveKnowledgeShare[]>;
  revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    revokedAt: string;
  }): Promise<RevokedKnowledgeShare | null>;
};

export type CreateKnowledgeShareInput = {
  organizationId: string;
  actorUserId: string;
  actorName?: string;
  title: string;
  contentMd: string;
  sourceDocumentId?: string;
  requestKey: string;
  expiresInDays?: number;
};

type CreateKnowledgeShareDependencies = {
  repository: KnowledgeShareRepository;
  putSnapshot: (key: string, snapshot: KnowledgeShareSnapshot) => Promise<void>;
  deleteSnapshot: (key: string) => Promise<void>;
  now?: () => Date;
  randomTokenBytes?: () => Buffer;
  newShareId?: () => string;
  onCleanupFailure?: (input: { shareId: string }) => void;
  onCompensationFailure: (
    input: KnowledgeShareCompensationFailure,
  ) => void | Promise<void>;
};

export function canManageKnowledgeShares(
  role: AppRole | null | undefined,
): boolean {
  return (
    role === "owner" || role === "ops_manager" || role === "operator_business"
  );
}

export function hashKnowledgeShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createKnowledgeShare(
  input: CreateKnowledgeShareInput,
  dependencies: CreateKnowledgeShareDependencies,
): Promise<{ id: string; token: string; expiresAt: string }> {
  const normalized = normalizeCreateInput(input);
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new InvalidKnowledgeShareInputError();
  }

  const tokenBytes = dependencies.randomTokenBytes?.() ?? randomBytes(32);
  if (tokenBytes.length !== 32) {
    throw new Error("Knowledge share token generator must return 32 bytes");
  }
  const token = tokenBytes.toString("base64url");
  const tokenHash = hashKnowledgeShareToken(token);
  const id = dependencies.newShareId?.() ?? randomUUID();
  const cosKey = `knowledge-base-share/${id}.json`;
  const expiresAt = new Date(
    now.getTime() + normalized.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  let metadataInserted = false;

  try {
    await dependencies.repository.insertPending({
      id,
      organizationId: normalized.organizationId,
      tokenHash,
      title: normalized.title,
      sourceDocumentId: normalized.sourceDocumentId,
      cosKey,
      requestKey: normalized.requestKey,
      createdBy: normalized.actorUserId,
      createdByName: normalized.actorName,
      expiresAt,
    });
    metadataInserted = true;

    await dependencies.putSnapshot(cosKey, {
      contentMd: normalized.contentMd,
    });

    const activated = await dependencies.repository.markActive({
      id,
      organizationId: normalized.organizationId,
    });
    if (!activated) {
      throw new Error("Knowledge share activation failed");
    }

    return { id, token, expiresAt };
  } catch (error) {
    if (metadataInserted) {
      const failedStages: KnowledgeShareCompensationStage[] = [];
      try {
        await dependencies.repository.markFailed({
          id,
          organizationId: normalized.organizationId,
        });
      } catch {
        failedStages.push("mark_failed");
      }
      try {
        await dependencies.deleteSnapshot(cosKey);
      } catch {
        failedStages.push("delete_snapshot");
        try {
          dependencies.onCleanupFailure?.({ shareId: id });
        } catch {
          console.error("Knowledge share cleanup observer failed", {
            shareId: id,
            failedStages: ["delete_snapshot"],
          });
        }
      }
      if (failedStages.length > 0) {
        try {
          await dependencies.onCompensationFailure({
            shareId: id,
            failedStages,
          });
        } catch {
          console.error("Knowledge share compensation observer failed", {
            shareId: id,
            failedStages,
          });
        }
      }
    }
    if (error instanceof DuplicateKnowledgeShareRequestError) {
      throw error;
    }
    throw new KnowledgeShareCreationError();
  }
}

export async function getPublicKnowledgeShare(
  token: string,
  dependencies: {
    repository: KnowledgeShareRepository;
    getSnapshot: (
      key: string,
    ) => Promise<KnowledgeShareSnapshot | null>;
    now?: () => Date;
  },
): Promise<PublicKnowledgeShare | null> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) return null;

  const metadata = await dependencies.repository.findPublicActive({
    tokenHash: hashKnowledgeShareToken(token),
    now: now.toISOString(),
  });
  if (!metadata) return null;

  const snapshot = await dependencies.getSnapshot(metadata.cosKey);
  if (!isKnowledgeShareSnapshot(snapshot)) return null;
  return {
    title: metadata.title,
    contentMd: snapshot.contentMd,
    ...(metadata.createdByName
      ? { sharedBy: metadata.createdByName }
      : null),
    createdAt: metadata.createdAt,
    expiresAt: metadata.expiresAt,
  };
}

export async function listActiveKnowledgeShares(
  input: { organizationId: string; sourceDocumentId?: string },
  dependencies: { repository: KnowledgeShareRepository; now?: () => Date },
): Promise<ActiveKnowledgeShare[]> {
  const sourceDocumentId = normalizeOptionalSourceDocumentId(
    input.sourceDocumentId,
  );
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new InvalidKnowledgeShareInputError();
  }
  return dependencies.repository.listActive({
    organizationId: input.organizationId,
    ...(sourceDocumentId ? { sourceDocumentId } : null),
    now: now.toISOString(),
  });
}

export async function revokeKnowledgeShare(
  input: { id: string; organizationId: string; actorUserId: string },
  dependencies: {
    repository: KnowledgeShareRepository;
    deleteSnapshot: (key: string) => Promise<void>;
    now?: () => Date;
    onCleanupFailure?: (input: { shareId: string }) => void;
  },
): Promise<{
  id: string;
  cleanupPending: boolean;
  newlyRevoked: boolean;
} | null> {
  const now = dependencies.now?.() ?? new Date();
  const revoked = await dependencies.repository.revoke({
    ...input,
    revokedAt: now.toISOString(),
  });
  if (!revoked) return null;

  try {
    await dependencies.deleteSnapshot(revoked.cosKey);
    return {
      id: revoked.id,
      cleanupPending: false,
      newlyRevoked: revoked.newlyRevoked,
    };
  } catch {
    dependencies.onCleanupFailure?.({ shareId: revoked.id });
    return {
      id: revoked.id,
      cleanupPending: true,
      newlyRevoked: revoked.newlyRevoked,
    };
  }
}

export function createKnowledgeShareRepository(
  client: SupabaseClient,
): KnowledgeShareRepository {
  return {
    async insertPending(input) {
      const { error } = await client.from("knowledge_share_links").insert({
        id: input.id,
        organization_id: input.organizationId,
        token_hash: input.tokenHash,
        title: input.title,
        source_document_id: input.sourceDocumentId,
        cos_key: input.cosKey,
        request_key: input.requestKey,
        created_by: input.createdBy,
        created_by_name: input.createdByName,
        expires_at: input.expiresAt,
        status: "pending",
      });
      if (error?.code === "23505") {
        const { data: existing, error: existingError } = await client
          .from("knowledge_share_links")
          .select("id, status, revoked_at, expires_at")
          .eq("organization_id", input.organizationId)
          .eq("created_by", input.createdBy)
          .eq("request_key", input.requestKey)
          .maybeSingle();
        if (!existingError && existing?.id) {
          const shareStatus = classifyKnowledgeShareRequestStatus(existing);
          if (shareStatus) {
            throw new DuplicateKnowledgeShareRequestError(
              String(existing.id),
              shareStatus,
            );
          }
        }
        throw error;
      }
      if (error) throw error;
    },

    async markActive(input) {
      const { data, error } = await client
        .from("knowledge_share_links")
        .update({ status: "active" })
        .eq("id", input.id)
        .eq("organization_id", input.organizationId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async markFailed(input) {
      const { error } = await client
        .from("knowledge_share_links")
        .update({ status: "failed" })
        .eq("id", input.id)
        .eq("organization_id", input.organizationId)
        .in("status", ["pending", "active"]);
      if (error) throw error;
    },

    async findPublicActive(input) {
      const { data, error } = await client
        .from("knowledge_share_links")
        .select("title, cos_key, created_by_name, created_at, expires_at")
        .eq("token_hash", input.tokenHash)
        .eq("status", "active")
        .is("revoked_at", null)
        .gt("expires_at", input.now)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        title: String(data.title),
        cosKey: String(data.cos_key),
        createdByName:
          typeof data.created_by_name === "string"
            ? data.created_by_name
            : null,
        createdAt: String(data.created_at),
        expiresAt: String(data.expires_at),
      };
    },

    async listActive(input) {
      let query = client
        .from("knowledge_share_links")
        .select("id, title, expires_at, created_at")
        .eq("organization_id", input.organizationId)
        .eq("status", "active")
        .is("revoked_at", null)
        .gt("expires_at", input.now);
      if (input.sourceDocumentId) {
        query = query.eq("source_document_id", input.sourceDocumentId);
      }
      const { data, error } = await query.order("created_at", {
        ascending: false,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        expiresAt: String(row.expires_at),
        createdAt: String(row.created_at),
      }));
    },

    async revoke(input) {
      const { data, error } = await client
        .from("knowledge_share_links")
        .update({
          revoked_at: input.revokedAt,
          revoked_by: input.actorUserId,
        })
        .eq("id", input.id)
        .eq("organization_id", input.organizationId)
        .is("revoked_at", null)
        .select("id, cos_key")
        .maybeSingle();
      if (error) throw error;
      if (data) {
        return {
          id: String(data.id),
          cosKey: String(data.cos_key),
          newlyRevoked: true,
        };
      }

      const { data: existing, error: existingError } = await client
        .from("knowledge_share_links")
        .select("id, cos_key")
        .eq("id", input.id)
        .eq("organization_id", input.organizationId)
        .not("revoked_at", "is", null)
        .maybeSingle();
      if (existingError) throw existingError;
      return existing
        ? {
            id: String(existing.id),
            cosKey: String(existing.cos_key),
            newlyRevoked: false,
          }
        : null;
    },
  };
}

function classifyKnowledgeShareRequestStatus(existing: {
  status?: unknown;
  revoked_at?: unknown;
  expires_at?: unknown;
}): KnowledgeShareRequestStatus | null {
  if (typeof existing.revoked_at === "string" && existing.revoked_at) {
    return "revoked";
  }
  if (typeof existing.expires_at === "string") {
    const expiresAt = new Date(existing.expires_at);
    if (
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt.getTime() <= Date.now()
    ) {
      return "expired";
    }
  }
  if (
    existing.status === "active" ||
    existing.status === "pending" ||
    existing.status === "failed"
  ) {
    return existing.status;
  }
  return null;
}

function normalizeCreateInput(input: CreateKnowledgeShareInput): {
  organizationId: string;
  actorUserId: string;
  actorName?: string;
  title: string;
  contentMd: string;
  sourceDocumentId: string | null;
  requestKey: string;
  expiresInDays: (typeof ALLOWED_KNOWLEDGE_SHARE_EXPIRY_DAYS)[number];
} {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const contentMd =
    typeof input.contentMd === "string" ? input.contentMd : "";
  const expiresInDays =
    input.expiresInDays ?? DEFAULT_KNOWLEDGE_SHARE_EXPIRY_DAYS;
  if (
    !input.organizationId ||
    !input.actorUserId ||
    !title ||
    title.length > MAX_KNOWLEDGE_SHARE_TITLE_LENGTH ||
    !contentMd.trim() ||
    Buffer.byteLength(contentMd, "utf8") >
      MAX_KNOWLEDGE_SHARE_CONTENT_BYTES ||
    !ALLOWED_KNOWLEDGE_SHARE_EXPIRY_DAYS.includes(
      expiresInDays as (typeof ALLOWED_KNOWLEDGE_SHARE_EXPIRY_DAYS)[number],
    ) ||
    typeof input.requestKey !== "string" ||
    input.requestKey.length > MAX_KNOWLEDGE_SHARE_REQUEST_KEY_LENGTH ||
    !REQUEST_KEY_PATTERN.test(input.requestKey)
  ) {
    throw new InvalidKnowledgeShareInputError();
  }
  const sourceDocumentId = normalizeOptionalSourceDocumentId(
    input.sourceDocumentId,
  );
  return {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    ...(input.actorName?.trim() ? { actorName: input.actorName.trim() } : null),
    title,
    contentMd,
    sourceDocumentId,
    requestKey: input.requestKey,
    expiresInDays:
      expiresInDays as (typeof ALLOWED_KNOWLEDGE_SHARE_EXPIRY_DAYS)[number],
  };
}

function normalizeOptionalSourceDocumentId(
  sourceDocumentId: string | undefined,
): string | null {
  if (sourceDocumentId === undefined || sourceDocumentId === "") return null;
  if (
    typeof sourceDocumentId !== "string" ||
    sourceDocumentId.length > MAX_KNOWLEDGE_SHARE_SOURCE_ID_LENGTH
  ) {
    throw new InvalidKnowledgeShareInputError();
  }
  return sourceDocumentId;
}

function isKnowledgeShareSnapshot(
  value: KnowledgeShareSnapshot | null,
): value is KnowledgeShareSnapshot {
  return Boolean(
    value &&
      typeof value.contentMd === "string" &&
      value.contentMd.trim() &&
      Buffer.byteLength(value.contentMd, "utf8") <=
        MAX_KNOWLEDGE_SHARE_CONTENT_BYTES,
  );
}
