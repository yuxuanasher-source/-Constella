import Link from "next/link";

import { OrganizationBrandMark } from "@/components/organization-brand/organization-brand-mark";
import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

import type { OpsV2NavItem } from "./navigation";

export function OpsSidebar({
  brand,
  logoUrl,
  activeHref,
  items,
}: {
  brand: PublishedOrganizationBrand;
  logoUrl?: string | null;
  activeHref: string;
  items: readonly OpsV2NavItem[];
}) {
  return (
    <aside className="ops-v2-sidebar" aria-label="经营端主导航">
      <div className="ops-v2-brand">
        <Link
          className="ops-v2-brand-link"
          href="/console/brand"
          prefetch={false}
          aria-label={`进入${brand.brandName}品牌中心`}
        >
          <span data-testid="ops-v2-brand-mark">
            <OrganizationBrandMark
              className="ops-v2-brand-mark"
              brandName={brand.brandName}
              logoText={brand.logoText}
              logoUrl={logoUrl ?? null}
            />
          </span>
          <span className="ops-v2-brand-copy">
            <span className="ops-v2-brand-name" title={brand.brandName}>
              {brand.brandName}
            </span>
            {brand.brandTagline ? (
              <span className="ops-v2-brand-tagline" title={brand.brandTagline}>
                {brand.brandTagline}
              </span>
            ) : null}
          </span>
          <span className="ops-v2-brand-center-label">品牌中心</span>
        </Link>
      </div>
      <nav className="ops-v2-nav" aria-label="业务页面">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              className="ops-v2-nav-item"
              data-active={active ? "true" : "false"}
              aria-current={active ? "page" : undefined}
              href={item.href}
              prefetch={false}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <p className="ops-v2-service-signature">由经营舱提供技术服务</p>
    </aside>
  );
}
