import { NextResponse } from "next/server";

import { bridgeCreateShare } from "@/features/marketplace/marketplace-bridge";
import { buildBridgeDeps } from "@/features/marketplace/marketplace-bridge-server";
import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";

// 发单方：为某个已启用 MCN 协作的现有项目建分享，token 落到撮合达成上（接单方据此提交）。
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getMarketplaceContext();
    const body = await request.json().catch(() => ({}));
    const projectId = String(body?.projectId ?? "");
    const result = await bridgeCreateShare(
      buildBridgeDeps(ctx),
      ctx.actor,
      id,
      projectId,
    );
    return NextResponse.json(result);
  } catch (error) {
    return marketplaceError(error);
  }
}
