import { NextResponse } from "next/server";

import {
  getMarketplaceContext,
  marketplaceError,
} from "@/features/marketplace/marketplace-route-utils";
import { publishPosting } from "@/features/marketplace/marketplace-service";

// GET：公开广场列表（默认）或 ?mine=1 我的发布；支持 category / postType / search 过滤。
export async function GET(request: Request) {
  try {
    const { repo, auth } = await getMarketplaceContext();
    const url = new URL(request.url);
    if (url.searchParams.get("mine") === "1") {
      const postings = await repo.listMyPostings(auth.organizationId);
      return NextResponse.json({ postings });
    }
    const postings = await repo.listPublicPostings({
      category: url.searchParams.get("category"),
      postType: url.searchParams.get("postType") as "demand" | "supply" | null,
      search: url.searchParams.get("search"),
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return NextResponse.json({ postings });
  } catch (error) {
    return marketplaceError(error);
  }
}

// POST：发布需求（默认 open，可传 publish:false 存草稿）。
export async function POST(request: Request) {
  try {
    const { repo, audit, actor } = await getMarketplaceContext();
    const body = await request.json().catch(() => ({}));
    const posting = await publishPosting(repo, audit, actor, body);
    return NextResponse.json({ posting });
  } catch (error) {
    return marketplaceError(error);
  }
}
