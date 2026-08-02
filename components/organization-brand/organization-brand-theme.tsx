import type { CSSProperties, ReactNode } from "react";

import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

export function OrganizationBrandTheme({
  brand,
  children,
}: {
  brand: PublishedOrganizationBrand;
  children: ReactNode;
}) {
  const style = {
    "--org-brand-primary": brand.primaryColor,
    "--org-brand-action": brand.actionColor,
    "--org-brand-soft": brand.softColor,
  } as CSSProperties;

  return (
    <div className="organization-brand-theme" style={style}>
      {children}
    </div>
  );
}
