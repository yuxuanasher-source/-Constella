import AdmissionSharePageClient from "./admission-share-page-client";

export default async function AdmissionSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ accessCode?: string | string[] }>;
}) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const accessCode = resolvedSearchParams.accessCode;

  return (
    <AdmissionSharePageClient
      token={token}
      initialAccessCode={typeof accessCode === "string" ? accessCode : ""}
    />
  );
}
