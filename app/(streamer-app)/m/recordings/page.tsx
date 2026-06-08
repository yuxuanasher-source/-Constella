import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";

import {
  getStreamerMobileContext,
  type StreamerMobileContext,
} from "../streamer-mobile-data";

export default async function StreamerRecordingsPage() {
  const context = await getStreamerMobileContext();
  const { recordings, projectAnnouncements } =
    await loadStreamerRecordingPageData(context);

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="videos"
        profile={context?.profile ?? undefined}
        recordings={recordings}
        projectAnnouncements={projectAnnouncements}
      />
    </div>
  );
}

async function loadStreamerRecordingPageData(
  context: StreamerMobileContext | null,
) {
  if (!context) {
    return { recordings: undefined, projectAnnouncements: undefined };
  }

  const input = {
    organizationId: context.auth.organizationId,
    streamerId: context.streamerId,
  };

  const [recordings, projectAnnouncements] = await Promise.all([
    listStreamerRecordingLinks(context.supabase, input),
    listStreamerProjectAnnouncements(context.supabase, input),
  ]);

  return { recordings, projectAnnouncements };
}
