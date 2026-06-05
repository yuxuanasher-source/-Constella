import StreamerDesktopReferenceApp from "@/components/reference-ui/streamer-desktop-reference";
import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  listNotificationCenterItems,
  type NotificationQueryClient,
} from "@/features/notifications/notification-center-queries";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerDesktopPage() {
  const [liveTasks, notificationItems, profile, recordings] = await Promise.all(
    [
      loadStreamerTasks(),
      loadStreamerNotifications(),
      loadStreamerProfile(),
      loadStreamerRecordings(),
    ],
  );

  return (
    <StreamerDesktopReferenceApp
      initialRoute="dashboard"
      liveTasks={liveTasks}
      notificationItems={notificationItems}
      profile={profile}
      recordings={recordings}
    />
  );
}

async function loadStreamerTasks() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return null;
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
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

  return listNotificationCenterItems(
    supabase as unknown as NotificationQueryClient,
    {
      userId: auth.userId,
      role: auth.role,
      organizationId: auth.organizationId,
    },
    { limit: 10 },
  );
}

async function loadStreamerProfile() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return null;
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
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

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
  if (!streamerId) {
    return null;
  }

  return listStreamerRecordingLinks(supabase, {
    organizationId: auth.organizationId,
    streamerId,
  });
}
