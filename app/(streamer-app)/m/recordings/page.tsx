import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerRecordingsPage() {
  const recordings = await loadStreamerRecordings();

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={recordings}
      />
    </div>
  );
}

async function loadStreamerRecordings() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return undefined;
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
  if (!streamerId) {
    return undefined;
  }

  return listStreamerRecordingLinks(supabase, {
    organizationId: auth.organizationId,
    streamerId,
  });
}
