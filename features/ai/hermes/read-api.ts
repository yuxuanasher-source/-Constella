import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  searchKnowledgeDocuments,
  type KnowledgeClient,
} from "@/features/ai/knowledge-repository";

import {
  HERMES_AUTH_ROLES,
  isHermesReadScope,
  isUuid,
  type HermesActorProfile,
  type HermesAuthRole,
  type HermesReadScope,
} from "./contracts";
import { verifyHermesActorAssertion } from "./actor-assertion";

export type HermesReadToolName =
  | "xingyao_get_current_context"
  | "xingyao_search_projects"
  | "xingyao_get_project_summary"
  | "xingyao_get_streamer_project_profile"
  | "xingyao_search_live_reports"
  | "xingyao_search_recording_reviews"
  | "xingyao_search_knowledge"
  | "xingyao_get_settlement_summary";

export type HermesReadEnvelope =
  | {
      status: "ok" | "partial";
      data: unknown;
      evidenceRefs: string[];
      sourceLabels: string[];
      updatedAt: string;
      missingData: string[];
      permissionDenials: string[];
      truncated: boolean;
      toolInvocationId: string;
      traceId: string;
    }
  | {
      status: "error";
      error: { code: HermesReadErrorCode };
      toolInvocationId: string;
      traceId: string;
    };

export type HermesReadErrorCode =
  | "unauthorized"
  | "permission_denied"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

export type HermesReadEndpointSpec = {
  toolName: HermesReadToolName;
  requiredScope: HermesReadScope;
  allowedRoles: readonly HermesAuthRole[];
};

export const HERMES_READ_ENDPOINTS: Record<
  HermesReadToolName,
  HermesReadEndpointSpec
> = {
  xingyao_get_current_context: {
    toolName: "xingyao_get_current_context",
    requiredScope: "context.read",
    allowedRoles: HERMES_AUTH_ROLES,
  },
  xingyao_search_projects: {
    toolName: "xingyao_search_projects",
    requiredScope: "projects.search",
    allowedRoles: ["owner", "ops_manager", "operator_business", "finance"],
  },
  xingyao_get_project_summary: {
    toolName: "xingyao_get_project_summary",
    requiredScope: "projects.summary",
    allowedRoles: ["owner", "ops_manager", "operator_business", "finance"],
  },
  xingyao_get_streamer_project_profile: {
    toolName: "xingyao_get_streamer_project_profile",
    requiredScope: "streamers.project_profile",
    allowedRoles: ["owner", "ops_manager", "operator_business"],
  },
  xingyao_search_live_reports: {
    toolName: "xingyao_search_live_reports",
    requiredScope: "live_reports.search",
    allowedRoles: ["owner", "ops_manager", "operator_business"],
  },
  xingyao_search_recording_reviews: {
    toolName: "xingyao_search_recording_reviews",
    requiredScope: "recording_reviews.search",
    allowedRoles: ["owner", "ops_manager", "operator_business"],
  },
  xingyao_search_knowledge: {
    toolName: "xingyao_search_knowledge",
    requiredScope: "knowledge.search",
    allowedRoles: ["owner", "ops_manager", "operator_business", "finance"],
  },
  xingyao_get_settlement_summary: {
    toolName: "xingyao_get_settlement_summary",
    requiredScope: "settlements.summary",
    allowedRoles: ["owner", "ops_manager", "finance"],
  },
};

type ReadAuthResult =
  | { ok: true; actor: HermesActorProfile; actorFingerprint: string }
  | { ok: false; status: number; envelope: HermesReadEnvelope };

export type HermesReadExecutionResult = {
  data: unknown;
  evidenceRefs?: string[];
  sourceLabels?: string[];
  missingData?: string[];
  permissionDenials?: string[];
  truncated?: boolean;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  ilike?: (...args: unknown[]) => QueryBuilder;
  order?: (...args: unknown[]) => QueryBuilder;
  limit?: (...args: unknown[]) => Promise<QueryResult> | QueryBuilder;
  maybeSingle?: () => Promise<SingleQueryResult>;
  then?: Promise<QueryResult>["then"];
};

type QueryResult = {
  data?: unknown[] | null;
  error?: { message?: string } | null;
};
type SingleQueryResult = {
  data?: unknown | null;
  error?: { message?: string } | null;
};
export type HermesReadDbClient = { from(table: string): QueryBuilder };

export async function authenticateHermesReadRequest(
  request: Request,
  spec: HermesReadEndpointSpec,
  env: Record<string, string | undefined> = process.env,
): Promise<ReadAuthResult> {
  const invocationId = randomUUID();
  const expectedToken = env.XINGYAO_READ_API_SERVICE_TOKEN?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (
    expectedToken.length < 32 ||
    !authorization.startsWith("Bearer ") ||
    !constantTimeEqual(authorization.slice("Bearer ".length), expectedToken)
  ) {
    return {
      ok: false,
      status: 401,
      envelope: hermesReadError(invocationId, "unauthorized"),
    };
  }

  const actorToken = request.headers.get("x-xingyao-actor") ?? "";
  const publicKeyPem = env.XINGYAO_ACTOR_JWS_PUBLIC_KEY?.trim() ?? "";
  const expectedKid = env.XINGYAO_ACTOR_JWS_KEY_ID?.trim() ?? "";
  if (!actorToken || !publicKeyPem || !expectedKid) {
    return {
      ok: false,
      status: 401,
      envelope: hermesReadError(invocationId, "unauthorized"),
    };
  }

  try {
    const verified = await verifyHermesActorAssertion(actorToken, {
      publicKeyPem,
    });
    if (
      verified.header.kid !== expectedKid ||
      authorizeHermesReadActor(verified.actor, spec) !== null
    ) {
      return {
        ok: false,
        status: 403,
        envelope: hermesReadError(
          verified.actor.invocationId,
          "permission_denied",
        ),
      };
    }
    return {
      ok: true,
      actor: verified.actor,
      actorFingerprint: verified.actorFingerprint,
    };
  } catch {
    return {
      ok: false,
      status: 401,
      envelope: hermesReadError(invocationId, "unauthorized"),
    };
  }
}

export function hermesReadSuccess(
  actor: HermesActorProfile,
  result: HermesReadExecutionResult,
): HermesReadEnvelope {
  return {
    status: result.truncated ? "partial" : "ok",
    data: result.data,
    evidenceRefs: metadataList(result.evidenceRefs),
    sourceLabels: metadataList(result.sourceLabels),
    updatedAt: new Date().toISOString(),
    missingData: metadataList(result.missingData),
    permissionDenials: metadataList(result.permissionDenials),
    truncated: Boolean(result.truncated),
    toolInvocationId: actor.invocationId,
    traceId: randomUUID(),
  };
}

export function hermesReadError(
  invocationId: string,
  code: HermesReadErrorCode,
): HermesReadEnvelope {
  return {
    status: "error",
    error: { code },
    toolInvocationId: isUuid(invocationId) ? invocationId : randomUUID(),
    traceId: randomUUID(),
  };
}

export function authorizeHermesReadActor(
  actor: HermesActorProfile,
  spec: HermesReadEndpointSpec,
): "permission_denied" | null {
  return actor.allowedReadScopes.includes(spec.requiredScope) &&
    spec.allowedRoles.includes(actor.role)
    ? null
    : "permission_denied";
}

export async function authorizeAndExecuteHermesReadTool(
  client: HermesReadDbClient,
  actor: HermesActorProfile,
  toolName: HermesReadToolName,
  filters: unknown,
): Promise<{ status: number; envelope: HermesReadEnvelope }> {
  const authorizationError = authorizeHermesReadActor(
    actor,
    HERMES_READ_ENDPOINTS[toolName],
  );
  if (authorizationError) {
    return {
      status: statusForHermesReadError(authorizationError),
      envelope: hermesReadError(actor.invocationId, authorizationError),
    };
  }

  const result = await executeHermesReadTool(client, actor, toolName, filters);
  if (typeof result === "string") {
    return {
      status: statusForHermesReadError(result),
      envelope: hermesReadError(actor.invocationId, result),
    };
  }
  return { status: 200, envelope: hermesReadSuccess(actor, result) };
}

export function statusForHermesReadError(code: HermesReadErrorCode): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "permission_denied":
      return 403;
    case "not_found":
      return 404;
    case "invalid_request":
      return 400;
    case "rate_limited":
      return 429;
    case "upstream_unavailable":
      return 503;
    case "internal_error":
      return 500;
  }
}

export async function executeHermesReadTool(
  client: HermesReadDbClient,
  actor: HermesActorProfile,
  toolName: HermesReadToolName,
  filters: unknown,
): Promise<HermesReadExecutionResult | HermesReadErrorCode> {
  const input = readFilters(filters);
  if (!input) return "invalid_request";

  switch (toolName) {
    case "xingyao_get_current_context":
      return {
        data: {
          organizationId: actor.organizationId,
          role: actor.role,
          conversationId: actor.conversationId,
          pageContext: actor.pageContext,
          allowedReadScopes: actor.allowedReadScopes,
          enabledSkillVersions: actor.enabledSkillVersions,
        },
        evidenceRefs: [`conversation:${actor.conversationId}`],
        sourceLabels: ["actor_context"],
      };
    case "xingyao_search_projects":
      return queryRows({
        client,
        actor,
        table: "projects",
        select:
          "id, name, status, started_at:starts_at, ended_at:ends_at, created_at, updated_at",
        query: input.query,
        queryColumn: "name",
        limit: input.limit,
        sourceLabel: "project_record",
      });
    case "xingyao_get_project_summary":
      return querySingleProject(client, actor, input.projectId);
    case "xingyao_get_streamer_project_profile":
      return queryRows({
        client,
        actor,
        table: "project_streamers",
        select:
          "project_id, streamer_id, status, settlement_method, hourly_rate, base_salary, cps_rate_bps, streamers(display_name)",
        projectId: input.projectId,
        streamerId: input.streamerId,
        limit: input.limit,
        sourceLabel: "project_streamer_record",
      });
    case "xingyao_search_live_reports":
      return queryRows({
        client,
        actor,
        table: "live_reports",
        select:
          "id, project_id, streamer_id, status, created_at, settlement_duration, time_source, evidence_level, viewers, risk_flags",
        projectId: input.projectId,
        streamerId: input.streamerId,
        limit: input.limit,
        sourceLabel: "live_report_record",
      });
    case "xingyao_search_recording_reviews":
      return queryRows({
        client,
        actor,
        table: "recording_assets",
        select:
          "id, title, review_status, preview_state, project_id, streamer_id, duration_seconds, created_at, updated_at",
        projectId: input.projectId,
        streamerId: input.streamerId,
        query: input.query,
        queryColumn: "title",
        limit: input.limit,
        sourceLabel: "recording_asset_record",
      });
    case "xingyao_search_knowledge":
      return queryKnowledge(client, actor, input.query, input.limit);
    case "xingyao_get_settlement_summary":
      return queryRows({
        client,
        actor,
        table: "settlement_batches",
        select:
          "id, project_id, batch_type, status, title, period_start, period_end, computed_amount, manual_amount, adjustment_amount, evidence_summary, updated_at",
        projectId: input.projectId,
        limit: input.limit,
        sourceLabel: "settlement_batch_record",
      });
  }
}

async function querySingleProject(
  client: HermesReadDbClient,
  actor: HermesActorProfile,
  projectId: string | undefined,
): Promise<HermesReadExecutionResult | HermesReadErrorCode> {
  if (!projectId) return "invalid_request";
  const builder = client
    .from("projects")
    .select(
      "id, name, status, started_at:starts_at, ended_at:ends_at, settlement_method:default_settlement_method, default_hourly_rate, default_base_salary, created_at, updated_at",
    )
    .eq("organization_id", actor.organizationId)
    .eq("id", projectId) as unknown as QueryBuilder;
  const result = await builder.maybeSingle?.();
  if (!result) return "internal_error";
  if (result.error) return "upstream_unavailable";
  if (!result.data) return "not_found";
  return {
    data: { project: result.data },
    evidenceRefs: [`project:${projectId}`],
    sourceLabels: ["project_record"],
  };
}

async function queryRows({
  client,
  actor,
  table,
  select,
  projectId,
  streamerId,
  query,
  queryColumn,
  limit,
  sourceLabel,
}: {
  client: HermesReadDbClient;
  actor: HermesActorProfile;
  table: string;
  select: string;
  projectId?: string;
  streamerId?: string;
  query?: string;
  queryColumn?: string;
  limit: number;
  sourceLabel: string;
}): Promise<HermesReadExecutionResult | HermesReadErrorCode> {
  let builder = client
    .from(table)
    .select(select)
    .eq("organization_id", actor.organizationId) as unknown as QueryBuilder;
  if (projectId) builder = builder.eq?.("project_id", projectId) ?? builder;
  if (streamerId) builder = builder.eq?.("streamer_id", streamerId) ?? builder;
  if (query && queryColumn) {
    builder =
      builder.ilike?.(queryColumn, `%${escapeIlike(query)}%`) ?? builder;
  }
  builder = builder.order?.("updated_at", { ascending: false }) ?? builder;
  const result = await (builder.limit?.(limit) as
    | Promise<QueryResult>
    | undefined);
  if (!result) return "internal_error";
  if (result.error) return "upstream_unavailable";
  const rows = Array.isArray(result.data) ? result.data : [];
  return {
    data: { rows },
    evidenceRefs: rows.map((row) => evidenceRef(table, row)).filter(Boolean),
    sourceLabels: [sourceLabel],
  };
}

async function queryKnowledge(
  client: HermesReadDbClient,
  actor: HermesActorProfile,
  query: string | undefined,
  limit: number,
): Promise<HermesReadExecutionResult | HermesReadErrorCode> {
  if (!query) return "invalid_request";
  const passages = await searchKnowledgeDocuments(
    client as unknown as KnowledgeClient,
    {
      organizationId: actor.organizationId,
      query,
      limit,
      candidateLimit: Math.max(limit * 20, 40),
    },
  ).catch(() => null);
  if (!passages) return "upstream_unavailable";
  return {
    data: {
      passages: passages.map((passage) => ({
        id: passage.id,
        title: passage.title,
        snippet: passage.snippet,
        sourceRef: passage.sourceRef,
        tags: passage.tags,
        score: passage.score,
      })),
    },
    evidenceRefs: passages.map((passage) => passage.sourceRef),
    sourceLabels: ["knowledge_document"],
  };
}

function readFilters(value: unknown): {
  query?: string;
  projectId?: string;
  streamerId?: string;
  limit: number;
} | null {
  if (!isPlainRecord(value)) return null;
  if (
    !Object.keys(value).every((key) =>
      ["limit", "projectId", "query", "streamerId"].includes(key),
    )
  ) {
    return null;
  }
  const query = optionalText(value.query, 120);
  const projectId = optionalUuid(value.projectId);
  const streamerId = optionalUuid(value.streamerId);
  const limit = limitValue(value.limit);
  return limit ? { query, projectId, streamerId, limit } : null;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalUuid(value: unknown): string | undefined {
  return value == null ? undefined : isUuid(value) ? value : undefined;
}

function limitValue(value: unknown): number | null {
  if (value == null) return 10;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.max(1, Math.min(value, 20));
}

function metadataList(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])]
    .map((value) => value.trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 100);
}

function evidenceRef(table: string, row: unknown): string {
  if (!isPlainRecord(row) || typeof row.id !== "string") return "";
  return `${table}:${row.id}`.slice(0, 160);
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (character) => `\\${character}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function hermesReadScopeForTool(
  toolName: HermesReadToolName,
): HermesReadScope {
  const scope = HERMES_READ_ENDPOINTS[toolName].requiredScope;
  if (!isHermesReadScope(scope)) {
    throw new Error(`Invalid Hermes read scope for ${toolName}`);
  }
  return scope;
}
