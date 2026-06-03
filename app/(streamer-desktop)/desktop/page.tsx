import StreamerDesktopReferenceApp from "@/components/reference-ui/streamer-desktop-reference";
import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerDesktopPage() {
  const liveTasks = await loadStreamerTasks();

  return (
    <StreamerDesktopReferenceApp
      initialRoute="dashboard"
      liveTasks={liveTasks}
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
