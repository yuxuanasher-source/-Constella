import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  listStreamerPayableItems,
  toStreamerEarningsSummary,
} from "@/features/settlements/streamer-settlement-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerMePage() {
  const liveEarnings = await loadStreamerEarnings();

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="me"
        liveEarnings={liveEarnings}
      />
    </div>
  );
}

async function loadStreamerEarnings() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return null;
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
  if (!streamerId) {
    return null;
  }

  const items = await listStreamerPayableItems(supabase, streamerId);
  return toStreamerEarningsSummary(items);
}
