import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import {
  listStreamerPayableItems,
  toStreamerEarningsSummary,
} from "@/features/settlements/streamer-settlement-queries";

import {
  getStreamerMobileContext,
  type StreamerMobileContext,
} from "../streamer-mobile-data";

export default async function StreamerMePage() {
  const context = await getStreamerMobileContext();
  const liveEarnings = await loadStreamerEarnings(context);

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="me"
        profile={context?.profile ?? undefined}
        liveEarnings={liveEarnings}
      />
    </div>
  );
}

async function loadStreamerEarnings(context: StreamerMobileContext | null) {
  if (!context) {
    return null;
  }

  const items = await listStreamerPayableItems(
    context.supabase,
    context.streamerId,
  );
  return toStreamerEarningsSummary(items);
}
