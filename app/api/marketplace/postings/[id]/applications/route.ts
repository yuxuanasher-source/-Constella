import { NextResponse } from "next/server";

import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";
import { submitApplication } from "@/features/marketplace/marketplace-service";

// GET：该需求下的接单投递（RLS：发单方见全部；其余平台 MCN 见已投递及之后状态）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { repo } = await getMarketplaceContext();
    const applications = await repo.listApplicationsForPosting(id);
    return NextResponse.json({ applications });
  } catch (error) {
    return marketplaceError(error);
  }
}

// POST：对该需求投递接单资料。
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { repo, audit, actor } = await getMarketplaceContext();
    const body = await request.json().catch(() => ({}));
    const application = await submitApplication(
      repo,
      audit,
      actor,
      id,
      body,
      new Date().toISOString(),
    );
    return NextResponse.json({ application });
  } catch (error) {
    return marketplaceError(error);
  }
}
