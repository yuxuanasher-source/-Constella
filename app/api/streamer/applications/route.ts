import { NextResponse } from "next/server";

import { listStreamerApplicationCards } from "@/features/applications/application-queries";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { parseListPagination } from "@/lib/http/pagination";

export async function GET(request: Request) {
  try {
    const context = await getAdmissionRouteContext();
    if (context.auth.role !== "streamer") {
      throw new RouteError(
        "Only streamers can view streamer application cards",
        403,
      );
    }

    const applications = await listStreamerApplicationCards(
      context.supabase,
      parseListPagination(request.url),
    );
    return NextResponse.json({ applications });
  } catch (error) {
    return jsonError(error);
  }
}
