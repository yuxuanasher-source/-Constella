import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";
import { listStreamerApplicationCards } from "@/features/applications/application-queries";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function StreamerRecordingsPage() {
  const supabase = await createSupabaseServerClient();
  const applicationCards = await listStreamerApplicationCards(supabase);

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="videos"
        applicationCards={applicationCards}
      />
    </div>
  );
}
