import StreamerMobileReferenceApp from "@/components/reference-ui/streamer-mobile-reference";

import { getStreamerMobileContext } from "../streamer-mobile-data";

export default async function StreamerDiagnosisPage() {
  const context = await getStreamerMobileContext();

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="ai"
        profile={context?.profile ?? undefined}
      />
    </div>
  );
}
