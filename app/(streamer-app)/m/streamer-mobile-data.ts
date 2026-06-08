import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function getStreamerMobileContext() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth || auth.role !== "streamer") {
    return null;
  }

  const streamerId = await getStreamerIdForUser(
    supabase,
    auth.userId,
    auth.organizationId,
  );
  if (!streamerId) {
    return null;
  }

  const profileRow = await getStreamerProfileRow(supabase, streamerId);

  return {
    supabase,
    auth,
    streamerId,
    profile: profileRow
      ? toStreamerDesktopProfileDto(profileRow, {
          organizationName: auth.organizationName,
        })
      : null,
  };
}

export type StreamerMobileContext = NonNullable<
  Awaited<ReturnType<typeof getStreamerMobileContext>>
>;
