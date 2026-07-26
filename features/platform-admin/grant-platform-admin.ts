import type { SupabaseClient } from "@supabase/supabase-js";

type ProfileMatch = {
  id: string;
  email: string;
};

export async function grantPlatformAdmin(input: {
  client: SupabaseClient;
  email: string;
}): Promise<{ email: string; userId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Email is required");
  }

  const { data, error } = await input.client
    .from("profiles")
    .select("id, email")
    .ilike("email", escapeLikePattern(email));

  if (error) {
    throw new Error(`Failed to look up profile: ${error.message}`);
  }

  const profiles = (data ?? []) as ProfileMatch[];
  if (profiles.length === 0) {
    throw new Error(`No profile found for ${email}`);
  }
  if (profiles.length > 1) {
    throw new Error(`Multiple profiles found for ${email}`);
  }

  const profile = profiles[0];
  const { error: grantError } = await input.client
    .from("platform_admins")
    .upsert({
      user_id: profile.id,
      role: "super_admin",
      status: "active",
    });

  if (grantError) {
    throw new Error(
      `Failed to grant platform administrator: ${grantError.message}`,
    );
  }

  return {
    email: profile.email.toLowerCase(),
    userId: profile.id,
  };
}

function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
