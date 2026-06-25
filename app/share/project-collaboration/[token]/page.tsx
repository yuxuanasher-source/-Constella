import ProjectCollaborationPageClient from "./project-collaboration-page-client";

export default async function ProjectCollaborationSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <ProjectCollaborationPageClient token={token} />;
}
