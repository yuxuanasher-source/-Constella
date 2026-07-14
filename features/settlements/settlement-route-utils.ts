import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { sendNotification } from "@/lib/notify/notify";

import {
  runProjectSettlementReconciliation,
  SupabaseReconciliationDataSource,
  type ProjectSettlementReconciliationRunResult,
  type ReconciliationDataSource,
} from "./project-settlement-reconciliation-service";
import { SupabaseSettlementRepository } from "./settlement-repository";
import type {
  SettlementActor,
  SettlementBatchGate,
  SettlementRepository,
} from "./settlement-service";

export type SettlementRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseSettlementRepository;
  gate?: SettlementBatchGate;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getSettlementRouteContext(): Promise<SettlementRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  const repo = new SupabaseSettlementRepository(supabase);
  return {
    supabase,
    auth,
    repo,
    gate: createSettlementBatchGate({
      repo,
      source: new SupabaseReconciliationDataSource(supabase),
      organizationId: auth.organizationId,
    }),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export function settlementActorFromContext(context: SettlementRouteContext) {
  return {
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
  };
}

export function createSettlementBatchGate({
  repo,
  source,
  organizationId,
}: {
  repo: Pick<
    SettlementRepository,
    "getSettlementBatchById" | "hasOpenSettlementRuleExceptions"
  >;
  source: ReconciliationDataSource;
  organizationId: string;
}): SettlementBatchGate {
  return {
    async assertNoOpenRuleExceptions(batchId: string): Promise<void> {
      const hasOpen = await repo.hasOpenSettlementRuleExceptions?.({
        organizationId,
        batchId,
      });
      if (hasOpen) {
        throw new Error("Settlement batch has unresolved rule exceptions");
      }
    },
    async evaluateReconciliation({
      batchId,
      actor,
      trigger,
    }: {
      batchId: string;
      actor: SettlementActor;
      trigger: "confirm" | "lock";
    }): Promise<ProjectSettlementReconciliationRunResult> {
      const batch = await repo.getSettlementBatchById(batchId);
      if (!batch || batch.organizationId !== organizationId) {
        throw new Error("Settlement batch not found");
      }
      return runProjectSettlementReconciliation({
        source,
        actor,
        projectId: batch.projectId,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        triggerType: "settlement_batch",
        triggerBatchId: batchId,
        onStep: undefined,
      });
    },
  };
}

export function settlementReconciliationRouteMetadata(
  reconciliation: ProjectSettlementReconciliationRunResult,
) {
  const checks = reconciliation.checks.map(normalizeReconciliationCheck);
  const coreCheckCodes = checks
    .filter((check) => check.source === "core")
    .map((check) => check.code);
  const customCheckCodes = checks
    .filter((check) => check.source === "custom_rule")
    .map((check) => check.code);
  return {
    checks,
    provenance: {
      coreCheckCodes,
      customCheckCodes,
    },
    run: reconciliation.run
      ? {
          id: reconciliation.run.id,
          inputHash: reconciliation.run.inputHash,
          createdAt: reconciliation.run.createdAt,
          freshness: "fresh" as const,
        }
      : { freshness: "not_persisted" as const },
    gate: {
      verdict: reconciliation.hasBlocking
        ? ("blocked" as const)
        : reconciliation.hasWarning
          ? ("warning" as const)
          : ("pass" as const),
      hasBlocking: reconciliation.hasBlocking,
      hasWarning: reconciliation.hasWarning,
      canConfirm: reconciliation.canConfirm,
      canLock: reconciliation.canLock,
    },
  };
}

function normalizeReconciliationCheck(
  check: ProjectSettlementReconciliationRunResult["checks"][number],
) {
  const source =
    "source" in check && check.source === "custom_rule"
      ? ("custom_rule" as const)
      : ("core" as const);
  return removeUndefined({
    code:
      "code" in check && typeof check.code === "string"
        ? check.code
        : "key" in check
          ? check.key
          : "unknown",
    severity: check.severity,
    source,
    ruleVersionId:
      "ruleVersionId" in check && typeof check.ruleVersionId === "string"
        ? check.ruleVersionId
        : undefined,
  });
}

export async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = optionalString(body, key);
  if (!value) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function requiredNumber(
  body: Record<string, unknown>,
  key: string,
): number {
  const value = optionalNumber(body, key);
  if (value === undefined) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function requiredQueryParam(url: string, key: string): string {
  const value = new URL(url).searchParams.get(key)?.trim();
  if (!value) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Validate ids up front so a malformed value (e.g. a project name typed into a
// project-id field) returns a clear 400 instead of reaching Postgres and
// surfacing as an opaque "invalid input syntax for type uuid" failure that the
// error handler can only report as a generic 500.
export function requiredUuid(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(body, key);
  if (!isUuid(value)) {
    throw new RouteError(`${key} must be a valid UUID`, 400);
  }

  return value;
}

export function requiredUuidQueryParam(url: string, key: string): string {
  const value = requiredQueryParam(url, key);
  if (!isUuid(value)) {
    throw new RouteError(`${key} must be a valid UUID`, 400);
  }

  return value;
}

type PostgrestErrorLike = {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

// Supabase surfaces database failures as PostgrestError objects (which, in some
// versions, are plain objects rather than Error instances). Detect them so they
// are mapped to a meaningful status with their message preserved, instead of
// collapsing to a generic "Unexpected error" 500 that hides the cause.
function isPostgrestError(error: unknown): error is PostgrestErrorLike {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" && typeof candidate.message === "string"
  );
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

export function jsonError(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (isPostgrestError(error)) {
    // SQLSTATE class 22 (data exception, e.g. invalid uuid/enum text) and class
    // 23 (integrity constraint violation) are caused by bad client input, so
    // report them as 400 with the database message. Anything else is an
    // unexpected server/DB fault — return 500 without leaking internals.
    const isClientError =
      error.code.startsWith("22") || error.code.startsWith("23");
    return NextResponse.json(
      { error: isClientError ? error.message : "Database error" },
      { status: isClientError ? 400 : 500 },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }

  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}

export class RouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
