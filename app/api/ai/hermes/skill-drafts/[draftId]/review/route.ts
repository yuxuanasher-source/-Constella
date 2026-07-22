import { NextResponse } from "next/server";

import {
  computeHermesSkillBundleSha256,
  validateHermesSkillBundle,
} from "@/features/ai/hermes/approved-skill-registry";
import {
  createHermesStateRepository,
  mapHermesStateRepositoryError,
  type HermesStateRepositoryClient,
} from "@/features/ai/hermes/hermes-state-repository";
import {
  loadHermesSkillSigningKeyFromEnv,
  signHermesSkillApproval,
} from "@/features/ai/hermes/skill-signing";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ draftId: string }> | { draftId: string };
};

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    auth.role !== "owner" ||
    request.headers.get("x-hermes-actor-type") === "model"
  ) {
    return NextResponse.json(
      { error: "Only product owners can review Hermes Skill drafts" },
      { status: 403 },
    );
  }
  const draftClient = supabase as unknown as SkillDraftReviewDbClient;
  const repositoryClient = supabase as unknown as HermesStateRepositoryClient;

  const body = await readJsonBody(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  const { draftId } = await Promise.resolve(context.params);
  const draft = await loadDraftForReview(draftClient, {
    draftId,
    organizationId: auth.organizationId,
    ownerUserId: auth.userId,
  });
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  if (draft.status !== "pending_review") {
    return NextResponse.json(
      { error: "Draft is not pending review" },
      { status: 409 },
    );
  }

  const repository = createHermesStateRepository(repositoryClient);
  const reviewNote =
    typeof body.reviewNote === "string" ? body.reviewNote.trim() : null;
  let signature: string | null = null;
  let signingKeyId: string | null = null;
  let publicKeyPem: string | undefined;

  if (decision === "approved") {
    const actualBundleHash = computeHermesSkillBundleSha256(draft.bundle);
    const bundleCheck = validateHermesSkillBundle(
      draft.bundle,
      draft.bundle_sha256,
    );
    if (actualBundleHash !== draft.bundle_sha256 || !bundleCheck.ok) {
      return NextResponse.json(
        { error: "Skill bundle failed safety validation" },
        { status: 400 },
      );
    }
    const signingKey = loadHermesSkillSigningKeyFromEnv();
    const signed = signHermesSkillApproval({
      manifest: draft.manifest,
      bundleSha256: draft.bundle_sha256,
      signingKey,
    });
    signature = signed.signature;
    signingKeyId = signed.signingKeyId;
    publicKeyPem = signingKey.publicKeyPem;
  }

  try {
    const reviewed = await repository.reviewSkillDraft(
      { organizationId: auth.organizationId, userId: auth.userId },
      {
        draftId,
        nextStatus: decision,
        reviewNote,
        signature,
        signingKeyId,
      },
    );
    return NextResponse.json(
      {
        draftId: reviewed.draftId,
        status: reviewed.status,
        signingKeyId,
        ...(publicKeyPem ? { publicKeyPem } : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = mapHermesStateRepositoryError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.code === "permission_denied" ? 403 : 400 },
    );
  }
}

async function loadDraftForReview(
  supabase: SkillDraftReviewDbClient,
  input: { draftId: string; organizationId: string; ownerUserId: string },
): Promise<SkillDraftRow | null> {
  const query = supabase
    .from("ai_hermes_skill_drafts")
    .select(
      "id, organization_id, owner_user_id, skill_id, version, manifest, bundle, bundle_sha256, status",
    );
  const chained = chainEq(query, "id", input.draftId);
  chainEq(chained, "organization_id", input.organizationId);
  const finalQuery = chainEq(chained, "owner_user_id", input.ownerUserId);
  if (!hasMaybeSingle(finalQuery)) return null;
  const { data, error } = await finalQuery.maybeSingle();
  if (error || !isSkillDraftRow(data)) return null;
  return data;
}

type SkillDraftReviewDbClient = {
  from(table: string): {
    select(columns: string): SkillDraftReviewQuery;
  };
};

type SkillDraftReviewQuery = {
  eq(column: string, value: unknown): SkillDraftReviewQuery;
  maybeSingle?: () => PromiseLike<{ data: unknown; error: unknown }>;
};

function chainEq<T>(query: T, column: string, value: unknown): T {
  const next = (query as { eq(column: string, value: unknown): T }).eq(
    column,
    value,
  );
  return next;
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return isPlainRecord(body) ? body : null;
  } catch {
    return null;
  }
}

type SkillDraftRow = {
  id: string;
  organization_id: string;
  owner_user_id: string;
  skill_id: string;
  version: number;
  manifest: Record<string, unknown>;
  bundle: string;
  bundle_sha256: string;
  status: string;
};

function isSkillDraftRow(value: unknown): value is SkillDraftRow {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.organization_id === "string" &&
    typeof value.owner_user_id === "string" &&
    typeof value.skill_id === "string" &&
    Number.isInteger(value.version) &&
    isPlainRecord(value.manifest) &&
    typeof value.bundle === "string" &&
    typeof value.bundle_sha256 === "string" &&
    typeof value.status === "string"
  );
}

function hasMaybeSingle(
  value: unknown,
): value is { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } {
  return isPlainRecord(value) && typeof value.maybeSingle === "function";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
