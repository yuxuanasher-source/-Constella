import StreamerDesktopReferenceApp from "@/components/reference-ui/streamer-desktop-reference";
import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  countUnreadNotificationCenterItems,
  listNotificationCenterItems,
  type NotificationQueryClient,
} from "@/features/notifications/notification-center-queries";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerDesktopPage() {
  const [
    liveTasks,
    notificationData,
    profile,
    recordings,
    projectAnnouncements,
  ] = await Promise.all([
    loadStreamerTasks(),
    loadStreamerNotifications(),
    loadStreamerProfile(),
    loadStreamerRecordings(),
    loadStreamerProjectAnnouncements(),
  ]);

  return (
    <StreamerDesktopReferenceApp
      initialRoute="dashboard"
      liveTasks={liveTasks}
      notificationItems={notificationData?.items}
      notificationUnreadCount={notificationData?.unreadCount}
      profile={profile}
      recordings={recordings}
      projectAnnouncements={projectAnnouncements}
    />
  );
}

async function loadStreamerTasks() {
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

  return listStreamerTaskCards(supabase, streamerId);
}

async function loadStreamerNotifications() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return null;
  }

  const notificationClient = supabase as unknown as NotificationQueryClient;
  const actor = {
    userId: auth.userId,
    role: auth.role,
    organizationId: auth.organizationId,
  };
  const [items, unreadCount] = await Promise.all([
    listNotificationCenterItems(notificationClient, actor, { limit: 10 }),
    countUnreadNotificationCenterItems(notificationClient, actor),
  ]);

  return { items, unreadCount };
}

async function loadStreamerProfile() {
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

  const row = await getStreamerProfileRow(supabase, streamerId);
  return row
    ? toStreamerDesktopProfileDto(row, {
        organizationName: auth.organizationName,
      })
    : null;
}

async function loadStreamerRecordings() {
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

  return listStreamerRecordingLinks(supabase, {
    organizationId: auth.organizationId,
    streamerId,
  });
}

async function loadStreamerProjectAnnouncements() {
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

  return listStreamerProjectAnnouncements(supabase, {
    organizationId: auth.organizationId,
    streamerId,
  });
}
