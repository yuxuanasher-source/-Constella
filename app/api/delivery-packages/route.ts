import { NextResponse } from "next/server";

import {
  listVendorDeliveryPackage,
  type DeliveryPackageActor,
  type DeliveryPackageClient,
} from "@/features/delivery-packages/delivery-package-dto";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff } from "@/lib/rbac/roles";

export const GET = withAuth(async ({ supabase, auth, request }) => {
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can view delivery packages" },
      { status: 403 },
    );
  }

  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 },
    );
  }

  const actor: DeliveryPackageActor = {
    userId: auth.userId,
    role: auth.role,
    organizationId: auth.organizationId,
  };
  const items = await listVendorDeliveryPackage(
    supabase as unknown as DeliveryPackageClient,
    actor,
    projectId,
  );

  return NextResponse.json({ items });
});
