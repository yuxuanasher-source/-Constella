import { NextResponse } from "next/server";

import {
  getMarketplaceContext,
  marketplaceError,
  MarketplaceHttpError,
} from "@/features/marketplace/marketplace-route-utils";

// GET：需求详情（走 RLS：公开订单任意平台 MCN 可读，草稿仅发单方可读）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { repo } = await getMarketplaceContext();
    const posting = await repo.getPostingById(id);
    if (!posting) {
      throw new MarketplaceHttpError("Posting not found", 404);
    }
    return NextResponse.json({ posting });
  } catch (error) {
    return marketplaceError(error);
  }
}
