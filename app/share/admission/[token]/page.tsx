import AdmissionSharePageClient from "./admission-share-page-client";

export default async function AdmissionSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AdmissionSharePageClient token={token} />;
}
