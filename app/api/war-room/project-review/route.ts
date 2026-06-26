import { NextResponse } from "next/server";

import {
  buildProjectReviewReport,
  type ProjectReviewInput,
} from "@/features/war-room/project-review-report";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff } from "@/lib/rbac/roles";

export const POST = withAuth(async ({ auth, request }) => {
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can build project review reports" },
      { status: 403 },
    );
  }

  const body = (await request.json()) as ProjectReviewInput;
  const report = buildProjectReviewReport(body);
  return NextResponse.json({ report });
});
