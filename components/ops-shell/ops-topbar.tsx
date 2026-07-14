import { Bell, Search } from "lucide-react";

export function OpsTopbar({
  organizationName,
  userName,
  role,
}: {
  organizationName: string;
  userName: string;
  role: string;
}) {
  return (
    <header className="ops-v2-topbar">
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{organizationName}</div>
        <div className="ops-v2-muted">
          {userName} · {role}
        </div>
      </div>
      <div
        aria-label="全局搜索"
        style={{
          height: 34,
          width: "min(360px, 36vw)",
          border: "1px solid var(--ops-border)",
          borderRadius: "var(--ops-radius-card)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          color: "var(--ops-text-3)",
          fontSize: 12,
        }}
      >
        <Search size={15} strokeWidth={1.8} aria-hidden="true" />
        <span>搜索项目、主播、任务</span>
      </div>
      <button
        type="button"
        aria-label="通知"
        title="通知"
        style={{
          width: 34,
          height: 34,
          border: "1px solid var(--ops-border)",
          borderRadius: "var(--ops-radius-card)",
          background: "var(--ops-surface)",
          display: "inline-grid",
          placeItems: "center",
          color: "var(--ops-text-2)",
        }}
      >
        <Bell size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </header>
  );
}
