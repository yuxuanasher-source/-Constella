import { NextResponse } from "next/server";

import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";
import { reviewApplication } from "@/features/marketplace/marketplace-service";
import type { ReviewAction } from "@/features/marketplace/marketplace-state";

const ACTIONS = new Set(["start_review", "approve", "reject", "request_more"]);

// POST：发单方审核投递（start_review / approve / reject / request_more）。
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { repo, audit, actor } = await getMarketplaceContext();
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Unsupported review action" },
        { status: 400 },
      );
    }
    const note = typeof body?.note === "string" ? body.note : null;
    const application = await reviewApplication(
      repo,
      audit,
      actor,
      id,
      action as ReviewAction,
      note,
      new Date().toISOString(),
    );
    return NextResponse.json({ application });
  } catch (error) {
    return marketplaceError(error);
  }
}
