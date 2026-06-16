import { NextResponse } from "next/server";

import {
  getPublicProjectCollaboration,
  submitProjectCollaborationApplication,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const supabase =
      createSupabaseAdminClient() ?? (await createSupabaseServerClient());
    if (!supabase) {
      throw new RouteError("Public collaboration service is unavailable", 500);
    }

    const repo = new SupabaseProjectCollaborationRepository(supabase);
    const collaboration = await getPublicProjectCollaboration({ repo, token });

    return NextResponse.json({
      collaboration: toPublicCollaborationResponse(collaboration),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const authClient = await createSupabaseServerClient();
    const auth = await getAuthContext(authClient);
    if (!authClient || !auth) {
      throw new RouteError("Unauthorized", 401);
    }

    const repoClient = createSupabaseAdminClient();
    if (!repoClient) {
      throw new RouteError("Public collaboration service is unavailable", 503);
    }

    const repo = new SupabaseProjectCollaborationRepository(repoClient);
    const body = await readJsonBody(request);
    const application = await submitProjectCollaborationApplication({
      repo,
      actor: auth,
      token,
      input: {
        requestedRevenueShareBps: requiredNumber(
          body.requestedRevenueShareBps,
          "requestedRevenueShareBps",
        ),
        applicantNote: optionalString(body.applicantNote),
      },
    });

    return NextResponse.json({ application });
  } catch (error) {
    return jsonError(error);
  }
}

async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredNumber(value: unknown, key: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RouteError(`${key} is required`, 400);
  }
  return value;
}

function jsonError(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
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

function toPublicCollaborationResponse(collaboration: unknown) {
  if (
    !collaboration ||
    typeof collaboration !== "object" ||
    !("available" in collaboration)
  ) {
    return collaboration;
  }

  if ((collaboration as { available?: unknown }).available !== true) {
    return collaboration;
  }

  const availableCollaboration = collaboration as {
    share?: Record<string, unknown>;
    project?: unknown;
  };
  const share = { ...(availableCollaboration.share ?? {}) };
  delete share.id;
  delete share.tokenHash;

  return {
    ...availableCollaboration,
    share,
  };
}

class RouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
