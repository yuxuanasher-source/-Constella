import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { toStreamerReferenceTask } from "@/features/live-operations/live-ui-adapters";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerTasksPage() {
  const liveTasks = await loadStreamerTasks();

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp initialRoute="home" liveTasks={liveTasks} />
    </div>
  );
}

async function loadStreamerTasks() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth || auth.role !== "streamer") {
    return undefined;
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
  if (!streamerId) {
    return undefined;
  }

  const tasks = await listStreamerTaskCards(supabase, streamerId);
  return tasks.map((task) => toStreamerReferenceTask(task));
}
