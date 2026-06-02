import { NextResponse } from "next/server";

import { listStreamerApplicationCards } from "@/features/applications/application-queries";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";

export async function GET() {
  try {
    const context = await getAdmissionRouteContext();
    if (context.auth.role !== "streamer") {
      throw new RouteError(
        "Only streamers can view streamer application cards",
        403,
      );
    }

    const applications = await listStreamerApplicationCards(context.supabase);
    return NextResponse.json({ applications });
  } catch (error) {
    return jsonError(error);
  }
}
