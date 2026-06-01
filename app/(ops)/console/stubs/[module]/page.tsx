import { Badge } from "@/components/ui/badge";

export default async function StubPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;

  return (
    <section className="mx-auto max-w-5xl rounded-lg border border-[var(--line)] bg-white p-8">
      <Badge tone="blue">{module.toUpperCase()}</Badge>
      <h1 className="mt-4 text-2xl font-semibold">模块外壳已就绪</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-500)]">
        本期只搭 P0 地基与项目发布纵切片，此模块保留导航、权限和布局入口，等待
        P1+ 按开发计划展开。
      </p>
    </section>
  );
}
