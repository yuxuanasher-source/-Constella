// 经营台路由级加载骨架：SSR 数据（鉴权 + 看板查询）就绪前先渲染占位，
// 避免导航时长时间白屏。样式对齐 components/ui 的设计变量，不引新依赖。
export default function ConsoleLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="加载中"
      className="min-h-screen animate-pulse bg-[var(--bg)]"
    >
      {/* 顶栏占位 */}
      <div className="flex h-14 items-center gap-4 border-b border-[var(--line)] bg-white px-6">
        <div className="h-6 w-24 rounded bg-[var(--ink-100)]" />
        <div className="hidden h-4 w-48 rounded bg-[var(--ink-50)] md:block" />
        <div className="ml-auto flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[var(--ink-100)]" />
          <div className="h-4 w-20 rounded bg-[var(--ink-50)]" />
        </div>
      </div>

      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6">
        {/* KPI 卡片占位 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]"
            >
              <div className="h-3 w-16 rounded bg-[var(--ink-50)]" />
              <div className="mt-3 h-6 w-24 rounded bg-[var(--ink-100)]" />
            </div>
          ))}
        </div>

        {/* 列表区占位 */}
        <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="h-4 w-32 rounded bg-[var(--ink-100)]" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4">
                <div className="h-4 w-1/3 rounded bg-[var(--ink-50)]" />
                <div className="h-4 w-1/4 rounded bg-[var(--ink-50)]" />
                <div className="ml-auto h-4 w-16 rounded bg-[var(--ink-50)]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
