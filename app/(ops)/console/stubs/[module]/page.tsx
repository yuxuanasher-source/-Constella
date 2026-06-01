import OpsReferenceApp from "@/components/reference-ui/ops-reference";

const routeByModule: Record<string, string> = {
  m0: "org",
  m1: "projects",
  m2: "streamers",
  m3: "streamers",
  m4: "tasks",
  m5: "reports",
  m6: "settle",
  m7: "audit",
  m8: "export",
  m9: "audit",
  m10: "warroom",
  m11: "warroom",
};

export default async function StubPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;

  return <OpsReferenceApp initialRoute={routeByModule[module] ?? "warroom"} />;
}
