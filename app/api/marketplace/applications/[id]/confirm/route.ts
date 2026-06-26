import { NextResponse } from "next/server";

import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";
import { confirmDeal } from "@/features/marketplace/marketplace-service";

// POST：接单方对「已通过」投递确认达成 → 落撮合关系，需求转 matched。
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { repo, audit, actor } = await getMarketplaceContext();
    const deal = await confirmDeal(repo, audit, actor, id);
    return NextResponse.json({ deal });
  } catch (error) {
    return marketplaceError(error);
  }
}
