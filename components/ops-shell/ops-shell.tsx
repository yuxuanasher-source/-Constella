import { OPS_V2_NAV_ITEMS } from "./navigation";
import { MobileNavigation } from "./mobile-navigation";
import { OpsSidebar } from "./ops-sidebar";
import { OpsTopbar } from "./ops-topbar";

export function OpsShell({
  children,
  organizationName,
  userName,
  role,
  activeHref = "/console",
}: {
  children: React.ReactNode;
  organizationName: string;
  userName: string;
  role: string;
  activeHref?: string;
}) {
  return (
    <div className="ops-v2-shell">
      <OpsSidebar
        brandName="经营舱"
        activeHref={activeHref}
        items={OPS_V2_NAV_ITEMS}
      />
      <div className="ops-v2-main">
        <OpsTopbar
          organizationName={organizationName}
          userName={userName}
          role={role}
        />
        <MobileNavigation activeHref={activeHref} items={OPS_V2_NAV_ITEMS} />
        {children}
      </div>
    </div>
  );
}
