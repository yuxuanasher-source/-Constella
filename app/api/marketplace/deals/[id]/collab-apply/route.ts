import { NextResponse } from "next/server";

import { bridgeSubmitApplication } from "@/features/marketplace/marketplace-bridge";
import { buildBridgeDeps } from "@/features/marketplace/marketplace-bridge-server";
import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";

// 接单方：据撮合达成上的分享 token 提交一条 submitted 协作申请，进入现有审核→激活。
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getMarketplaceContext();
    const body = await request.json().catch(() => ({}));
    const result = await bridgeSubmitApplication(buildBridgeDeps(ctx), ctx.actor, id, {
      requestedRevenueShareBps: body?.requestedRevenueShareBps,
      applicantNote: body?.applicantNote,
    });
    return NextResponse.json(result);
  } catch (error) {
    return marketplaceError(error);
  }
}
