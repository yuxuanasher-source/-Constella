import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { listStreamerRecordingAssets } from "@/features/recordings/recording-asset-library";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getPrivateStorageBucket } from "@/lib/config/env";

import {
  getStreamerMobileContext,
  type StreamerMobileContext,
} from "../streamer-mobile-data";

export default async function StreamerRecordingsPage() {
  const context = await getStreamerMobileContext();
  const { recordings, recordingAssets, projectAnnouncements } =
    await loadStreamerRecordingPageData(context);

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="videos"
        profile={context?.profile ?? undefined}
        recordings={recordings}
        recordingAssets={recordingAssets}
        projectAnnouncements={projectAnnouncements}
      />
    </div>
  );
}

async function loadStreamerRecordingPageData(
  context: StreamerMobileContext | null,
) {
  if (!context) {
    return {
      recordings: undefined,
      recordingAssets: undefined,
      projectAnnouncements: undefined,
    };
  }

  const input = {
    organizationId: context.auth.organizationId,
    streamerId: context.streamerId,
  };

  const [recordings, recordingAssets, projectAnnouncements] = await Promise.all(
    [
      listStreamerRecordingLinks(context.supabase, input),
      listStreamerRecordingAssets(context.supabase, {
        ...input,
        bucket: getPrivateStorageBucket(),
      }),
      listStreamerProjectAnnouncements(context.supabase, input),
    ],
  );

  return { recordings, recordingAssets, projectAnnouncements };
}
