import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PlatformAdminConflictError,
  PlatformAdminProviderUnavailableError,
  PlatformAdminValidationError,
} from "@/features/platform-admin/platform-admin-errors";
import type { PlatformOrganizationAuthAdmin } from "@/features/platform-admin/platform-admin-organization-service";

export function createPlatformOrganizationAuthAdmin(
  client: SupabaseClient,
): PlatformOrganizationAuthAdmin {
  return {
    createUser: (input) => client.auth.admin.createUser(input),
    inviteUserByEmail: (email, options) =>
      client.auth.admin.inviteUserByEmail(email, options),
    deleteUser: (userId) => client.auth.admin.deleteUser(userId),
    sendPasswordReset: async (email) => {
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) {
        throw new Error(`Failed to send password reset: ${error.message}`);
      }
    },
  };
}

export function platformMutationErrorResponse(error: unknown) {
  if (error instanceof PlatformAdminProviderUnavailableError) {
    return Response.json(
      {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: error.message,
        },
      },
      { status: 503 },
    );
  }
  if (error instanceof PlatformAdminConflictError) {
    return Response.json(
      {
        error: {
          code: "CONFLICT",
          message: error.message,
        },
      },
      { status: 409 },
    );
  }
  if (error instanceof PlatformAdminValidationError) {
    return Response.json(
      {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: error.message,
        },
      },
      { status: 422 },
    );
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return Response.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "The request body is invalid.",
        },
      },
      { status: 400 },
    );
  }
  return Response.json(
    {
      error: {
        code: "WRITE_FAILED",
        message: "Unable to complete the platform administration operation.",
      },
    },
    { status: 500 },
  );
}
