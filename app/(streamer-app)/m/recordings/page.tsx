import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerRecordingsPage() {
  const { recordings, projectAnnouncements } =
    await loadStreamerRecordingPageData();

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={recordings}
        projectAnnouncements={projectAnnouncements}
      />
    </div>
  );
}

async function loadStreamerRecordingPageData() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return { recordings: undefined, projectAnnouncements: undefined };
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
  if (!streamerId) {
    return { recordings: undefined, projectAnnouncements: undefined };
  }

  const input = {
    organizationId: auth.organizationId,
    streamerId,
  };

  const [recordings, projectAnnouncements] = await Promise.all([
    listStreamerRecordingLinks(supabase, input),
    listStreamerProjectAnnouncements(supabase, input),
  ]);

  return { recordings, projectAnnouncements };
}
