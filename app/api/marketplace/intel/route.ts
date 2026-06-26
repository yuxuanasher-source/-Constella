import { NextResponse } from "next/server";

import {
  computeApplicantProfiles,
  computeMarketDynamics,
  computeMatches,
  computeSupplyHeat,
} from "@/features/marketplace/marketplace-intel";
import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";

// L1 撮合情报：基于全公开数据(走 RLS)做确定性聚合 + 智能匹配。
// 市场动态 / 供给热度 / 接单画像 / 智能匹配；数字均带 sourceRef，AI 不编造。
export async function GET() {
  try {
    const { repo, auth } = await getMarketplaceContext();
    const nowMs = Date.now();

    const [publicPostings, publicApplications, myPostings, myApplications] =
      await Promise.all([
        repo.listPublicPostings({ limit: 100 }),
        repo.listPublicApplications(500),
        repo.listMyPostings(auth.organizationId),
        repo.listMyApplications(auth.organizationId),
      ]);

    const marketDynamics = computeMarketDynamics(publicPostings, nowMs, 7);
    const supplyHeat = computeSupplyHeat(publicPostings);
    const applicantProfiles = computeApplicantProfiles(
      publicApplications,
      publicPostings,
      10,
    );
    const matches = computeMatches(
      {
        organizationId: auth.organizationId,
        myApplicationPostingIds: myApplications.map((a) => a.postingId),
        myOpenPostingCategories: myPostings
          .filter((p) => p.status === "open")
          .map((p) => p.category)
          .filter((c): c is string => Boolean(c)),
      },
      publicPostings,
      publicApplications,
      nowMs,
    );

    return NextResponse.json({
      marketDynamics,
      supplyHeat,
      applicantProfiles,
      matches,
    });
  } catch (error) {
    return marketplaceError(error);
  }
}
