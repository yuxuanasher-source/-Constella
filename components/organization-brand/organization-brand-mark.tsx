"use client";

import { useState } from "react";

type OrganizationBrandMarkProps = {
  brandName: string;
  logoText: string;
  logoUrl: string | null;
  className?: string;
  decorative?: boolean;
};

export function OrganizationBrandMark({
  brandName,
  logoText,
  logoUrl,
  className,
  decorative = false,
}: OrganizationBrandMarkProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);

  const fallback =
    sliceCodePoints(logoText.trim(), 8) ||
    sliceCodePoints(brandName.trim(), 4) ||
    "品牌";
  const showImage = Boolean(logoUrl) && failedLogoUrl !== logoUrl;

  return (
    <span className={className} data-brand-mark="true">
      {showImage ? (
        // Signed and local object URLs are already normalized logo assets and
        // cannot use the static Next Image optimization pipeline.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl ?? undefined}
          alt={decorative ? "" : `${brandName || "组织"}品牌标识`}
          onError={() => setFailedLogoUrl(logoUrl)}
        />
      ) : (
        <span aria-hidden={decorative ? "true" : undefined}>{fallback}</span>
      )}
    </span>
  );
}

function sliceCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}
