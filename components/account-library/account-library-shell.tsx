"use client";

import {
  Sidebar as SidebarRaw,
  TopBar as TopBarRaw,
} from "@/components/reference-ui/ops-reference";

// ops-reference 为无类型 JSX 模块，转为宽松类型以传入实际数据。
const Sidebar = SidebarRaw as unknown as React.FC<Record<string, unknown>>;
const TopBar = TopBarRaw as unknown as React.FC<Record<string, unknown>>;

/**
 * 复用主站 ops-reference 的侧栏与顶栏，让账号库页与主站视觉一致。
 * 账号库是真实数据页，故仅借外壳；点击其他导航项回到主站 /console。
 */
export function AccountLibraryShell({
  orgName,
  userName,
  role,
  unreadCount,
  children,
}: {
  orgName: string;
  userName: string;
  role: string;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const backToConsole = () => window.location.assign("/console");

  return (
    <div
      style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}
    >
      <Sidebar
        route="ext-account-library"
        onNav={backToConsole}
        currentUser={{ name: userName, role, org: orgName }}
        organizationSettings={{ name: orgName }}
        organizationMembers={null}
        onOpenOrganizationSettings={backToConsole}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          maxHeight: "100vh",
        }}
      >
        <TopBar breadcrumbs={["账号库"]} notificationCount={unreadCount} />
        <div id="content-scroll" style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: 20 }}>{children}</div>
        </div>
      </main>
    </div>
  );
}
