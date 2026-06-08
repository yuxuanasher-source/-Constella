import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { toStreamerReferenceTask } from "@/features/live-operations/live-ui-adapters";

import {
  getStreamerMobileContext,
  type StreamerMobileContext,
} from "../streamer-mobile-data";

export default async function StreamerTasksPage() {
  const context = await getStreamerMobileContext();
  const liveTasks = await loadStreamerTasks(context);

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="home"
        profile={context?.profile ?? undefined}
        liveTasks={liveTasks}
      />
    </div>
  );
}

async function loadStreamerTasks(context: StreamerMobileContext | null) {
  if (!context) {
    return undefined;
  }

  const tasks = await listStreamerTaskCards(
    context.supabase,
    context.streamerId,
  );
  return tasks.map((task) => toStreamerReferenceTask(task));
}
