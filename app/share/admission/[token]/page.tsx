import AdmissionSharePageClient from "./admission-share-page-client";

import { isAdmissionShareBrandUiEnabled } from "@/features/ui-route-contracts/admission-share-brand-ui-flag";
import "@/styles/public-share.css";

export default async function AdmissionSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AdmissionSharePageClient
      token={token}
      brandUiEnabled={isAdmissionShareBrandUiEnabled()}
    />
  );
}
