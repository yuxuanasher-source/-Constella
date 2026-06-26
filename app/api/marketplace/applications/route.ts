import { NextResponse } from "next/server";

import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";

// GET：我的投递（本组织作为接单方提交的全部投递）。
export async function GET() {
  try {
    const { repo, auth } = await getMarketplaceContext();
    const applications = await repo.listMyApplications(auth.organizationId);
    return NextResponse.json({ applications });
  } catch (error) {
    return marketplaceError(error);
  }
}
