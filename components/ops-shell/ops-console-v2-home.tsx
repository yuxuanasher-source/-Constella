import { BarChart3 } from "./navigation";
import { OpsShell } from "./ops-shell";

type DashboardKpi = {
  label?: string;
  title?: string;
  value?: string | number;
  count?: string | number;
  unit?: string;
};

function dashboardKpis(value: unknown): DashboardKpi[] {
  const kpis = (value as { kpis?: unknown })?.kpis;
  return Array.isArray(kpis) ? kpis.slice(0, 4) : [];
}

function displayKpiValue(kpi: DashboardKpi): string {
  const value = kpi.value ?? kpi.count ?? 0;
  return `${value}${kpi.unit ?? ""}`;
}

export function OpsConsoleV2Home({
  dashboardHome,
  dashboardHomeError,
  currentUser,
  organizationSettings,
}: {
  dashboardHome: unknown;
  dashboardHomeError: string | null;
  currentUser: { name?: string; role?: string };
  organizationSettings: { name?: string };
}) {
  const kpis = dashboardKpis(dashboardHome);

  return (
    <OpsShell
      organizationName={organizationSettings.name ?? "未连接组织"}
      userName={currentUser.name ?? "未登录用户"}
      role={currentUser.role ?? "guest"}
      activeHref="/console"
    >
      <main className="ops-v2-content">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <h1 className="ops-v2-page-title">经营总览</h1>
            <p className="ops-v2-muted" style={{ margin: "6px 0 0" }}>
              {dashboardHomeError ??
                (dashboardHome as { profile?: { title?: string } })?.profile
                  ?.title ??
                "实时经营看板"}
            </p>
          </div>
          <BarChart3
            size={24}
            strokeWidth={1.8}
            color="var(--ops-primary)"
            aria-hidden="true"
          />
        </div>

        <section className="ops-v2-grid ops-v2-kpi-grid" aria-label="经营指标">
          {(kpis.length ? kpis : [{ label: "待处理", value: 0 }]).map(
            (kpi, index) => (
              <article className="ops-v2-card" key={`${kpi.label}-${index}`}>
                <p className="ops-v2-card-label">
                  {kpi.label ?? kpi.title ?? "指标"}
                </p>
                <p className="ops-v2-card-value">{displayKpiValue(kpi)}</p>
              </article>
            ),
          )}
        </section>
      </main>
    </OpsShell>
  );
}
