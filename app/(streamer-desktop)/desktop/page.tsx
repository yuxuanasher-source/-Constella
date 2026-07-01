import StreamerDesktopReferenceApp from "@/components/reference-ui/streamer-desktop-reference";
import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  countUnreadNotificationCenterItems,
  listNotificationCenterItems,
  type NotificationQueryClient,
} from "@/features/notifications/notification-center-queries";
import { listStreamerRecordingAssets } from "@/features/recordings/recording-asset-library";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerDesktopPage() {
  const context = await getStreamerDesktopContext();
  const [
    liveTasks,
    notificationData,
    profile,
    recordings,
    recordingAssets,
    projectAnnouncements,
  ] = context
    ? await Promise.all([
        loadStreamerTasks(context),
        loadStreamerNotifications(context),
        loadStreamerProfile(context),
        loadStreamerRecordings(context),
        loadStreamerRecordingAssets(context),
        loadStreamerProjectAnnouncements(context),
      ])
    : [null, null, null, null, null, null];

  return (
    <StreamerDesktopReferenceApp
      initialRoute="dashboard"
      liveTasks={liveTasks}
      notificationItems={notificationData?.items}
      notificationUnreadCount={notificationData?.unreadCount}
      profile={profile}
      recordings={recordings}
      recordingAssets={recordingAssets}
      projectAnnouncements={projectAnnouncements}
    />
  );
}

type StreamerDesktopContext = {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  auth: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>;
  streamerId: string;
};

async function getStreamerDesktopContext(): Promise<StreamerDesktopContext | null> {
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

  return { supabase, auth, streamerId };
}

async function loadStreamerTasks(context: StreamerDesktopContext) {
  return listStreamerTaskCards(context.supabase, context.streamerId);
}

async function loadStreamerNotifications(context: StreamerDesktopContext) {
  const notificationClient =
    context.supabase as unknown as NotificationQueryClient;
  const actor = {
    userId: context.auth.userId,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
  };
  const [items, unreadCount] = await Promise.all([
    listNotificationCenterItems(notificationClient, actor, { limit: 10 }),
    countUnreadNotificationCenterItems(notificationClient, actor),
  ]);

  return { items, unreadCount };
}

async function loadStreamerProfile(context: StreamerDesktopContext) {
  const row = await getStreamerProfileRow(context.supabase, context.streamerId);
  return row
    ? toStreamerDesktopProfileDto(row, {
        organizationName: context.auth.organizationName,
      })
    : null;
}

async function loadStreamerRecordings(context: StreamerDesktopContext) {
  return listStreamerRecordingLinks(context.supabase, {
    organizationId: context.auth.organizationId,
    streamerId: context.streamerId,
  });
}

async function loadStreamerRecordingAssets(context: StreamerDesktopContext) {
  return listStreamerRecordingAssets(context.supabase, {
    organizationId: context.auth.organizationId,
    streamerId: context.streamerId,
    bucket: getPrivateStorageBucket(),
  });
}

async function loadStreamerProjectAnnouncements(
  context: StreamerDesktopContext,
) {
  return listStreamerProjectAnnouncements(context.supabase, {
    organizationId: context.auth.organizationId,
    streamerId: context.streamerId,
  });
}
