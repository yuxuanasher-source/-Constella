import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";
import { canManageOrganizationSettings } from "@/lib/rbac/permissions";

const legacyBrandFields = ["logoText", "brandName", "brandTagline"] as const;

const settingsBodySchema = z.strictObject({
  name: z.string().trim().min(1, "Organization name cannot be empty").max(60),
});

export async function PATCH(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return safeError(
        "Organization settings service is unavailable",
        503,
        "ORGANIZATION_SETTINGS_UNAVAILABLE",
      );
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return safeError("Unauthorized", 401, "UNAUTHORIZED");
    }
    if (!canManageOrganizationSettings(auth.role)) {
      return safeError(
        "Only owner can update organization settings",
        403,
        "ORGANIZATION_SETTINGS_FORBIDDEN",
      );
    }

    const inspection = await readInspectionBody(request.clone());
    if (
      inspection &&
      legacyBrandFields.some((field) =>
        Object.prototype.hasOwnProperty.call(inspection, field),
      )
    ) {
      return safeError(
        "Brand settings have moved to Brand Studio",
        409,
        "BRAND_STUDIO_REQUIRED",
      );
    }

    const body = await parseJsonBody(request, settingsBodySchema);
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return safeError(
        "Organization settings service is unavailable",
        503,
        "ORGANIZATION_SETTINGS_UNAVAILABLE",
      );
    }

    const current = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", auth.organizationId)
      .maybeSingle<{ id: string; name: string }>();
    if (current.error) {
      return safeError(
        "Organization settings service is unavailable",
        503,
        "ORGANIZATION_SETTINGS_UNAVAILABLE",
      );
    }
    if (!current.data) {
      return safeError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }
    const currentName = current.data.name.trim();
    if (currentName === body.name) {
      return NextResponse.json({
        organization: { id: current.data.id, name: currentName },
      });
    }

    const update = await admin
      .from("organizations")
      .update({ name: body.name })
      .eq("id", auth.organizationId)
      .select("id, name")
      .maybeSingle<{ id: string; name: string }>();
    if (update.error) {
      return safeError(
        "Organization settings service is unavailable",
        503,
        "ORGANIZATION_SETTINGS_UNAVAILABLE",
      );
    }
    if (!update.data) {
      return safeError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    try {
      await writeAuditLog(admin, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        actorName: auth.name,
        actorRole: auth.role,
        action: "update",
        module: "organization",
        objectType: "organization_settings",
        objectId: auth.organizationId,
        objectName: update.data.name,
        before: { name: current.data.name },
        after: { name: update.data.name },
        changedFields: ["name"],
      });
    } catch {
      return safeError(
        "Organization settings changed, but its audit record could not be written",
        503,
        "ORGANIZATION_SETTINGS_AUDIT_FAILED",
        {
          organization: { id: update.data.id, name: update.data.name },
        },
      );
    }

    return NextResponse.json({
      organization: { id: update.data.id, name: update.data.name },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return safeError(error.message, 400, "INVALID_REQUEST");
    }
    return safeError(
      "Organization settings service is unavailable",
      503,
      "ORGANIZATION_SETTINGS_UNAVAILABLE",
    );
  }
}

async function readInspectionBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeError(
  message: string,
  status: number,
  code: string,
  details: Record<string, unknown> = {},
) {
  return NextResponse.json({ error: message, code, ...details }, { status });
}
