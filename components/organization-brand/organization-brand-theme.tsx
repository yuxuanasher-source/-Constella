"use client";

import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

const OrganizationBrandStyleContext = createContext<CSSProperties | null>(null);

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
    <OrganizationBrandStyleContext.Provider value={style}>
      <div className="organization-brand-theme" style={style}>
        {children}
      </div>
    </OrganizationBrandStyleContext.Provider>
  );
}

export function OrganizationBrandPortal({ children }: { children: ReactNode }) {
  const style = useContext(OrganizationBrandStyleContext);

  if (!style) return <>{children}</>;

  return (
    <div
      className="organization-brand-theme organization-brand-theme-portal"
      style={style}
    >
      {children}
    </div>
  );
}
