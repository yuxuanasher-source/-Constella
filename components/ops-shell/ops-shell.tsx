import Link from "next/link";

import { OrganizationBrandMark } from "@/components/organization-brand/organization-brand-mark";
import { OrganizationBrandTheme } from "@/components/organization-brand/organization-brand-theme";
import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

import { OPS_V2_NAV_ITEMS } from "./navigation";
import { MobileNavigation } from "./mobile-navigation";
import { OpsSidebar } from "./ops-sidebar";
import { OpsTopbar } from "./ops-topbar";

export function OpsShell({
  children,
  brand,
  logoUrl = null,
  organizationName,
  userName,
  role,
  activeHref = "/console",
}: {
  children: React.ReactNode;
  brand: PublishedOrganizationBrand;
  logoUrl?: string | null;
  organizationName: string;
  userName: string;
  role: string;
  activeHref?: string;
}) {
  return (
    <OrganizationBrandTheme brand={brand}>
      <div className="ops-v2-shell">
        <OpsSidebar
          brand={brand}
          logoUrl={logoUrl}
          activeHref={activeHref}
          items={OPS_V2_NAV_ITEMS}
        />
        <div className="ops-v2-main">
          <div className="ops-v2-mobile-brand">
            <Link
              className="ops-v2-mobile-brand-link"
              href="/console/brand"
              prefetch={false}
              aria-label={`进入${brand.brandName}品牌中心`}
            >
              <OrganizationBrandMark
                className="ops-v2-brand-mark"
                brandName={brand.brandName}
                logoText={brand.logoText}
                logoUrl={logoUrl}
              />
              <span className="ops-v2-brand-copy">
                <span className="ops-v2-brand-name">{brand.brandName}</span>
                {brand.brandTagline ? (
                  <span className="ops-v2-brand-tagline">
                    {brand.brandTagline}
                  </span>
                ) : null}
              </span>
            </Link>
          </div>
          <OpsTopbar
            organizationName={organizationName}
            userName={userName}
            role={role}
          />
          <MobileNavigation activeHref={activeHref} items={OPS_V2_NAV_ITEMS} />
          {children}
        </div>
      </div>
    </OrganizationBrandTheme>
  );
}
