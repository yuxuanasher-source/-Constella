import type { SupabaseClient } from "@supabase/supabase-js";

import { requireConsoleStaffAuth } from "../console-auth";
import { OrganizationBrandCenter } from "@/components/organization-brand/brand-center";
import { SupabaseOrganizationBrandRepository } from "@/features/organizations/organization-brand-repository";
import {
  OrganizationBrandService,
  type OrganizationBrandStudioDto,
} from "@/features/organizations/organization-brand-service";
import { getPrivateStorageBucket } from "@/lib/config/env";

const BRAND_LOGO_SIGNED_URL_TTL_SECONDS = 120;

export default async function OrganizationBrandPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const service = new OrganizationBrandService(
    new SupabaseOrganizationBrandRepository(supabase),
  );

  let loaded:
    | {
        studio: OrganizationBrandStudioDto;
        publishedLogoUrl: string | null;
        draftLogoUrl: string | null;
      }
    | undefined;
  try {
    const studio = await service.getOrganizationBrandStudio(auth);
    const [publishedLogoUrl, draftLogoUrl] = await Promise.all([
      createBrandLogoSignedUrl(supabase, studio.published.logoStoragePath),
      createBrandLogoSignedUrl(
        supabase,
        studio.permissions.canManageBrand
          ? (studio.draft?.content.logoStoragePath ?? null)
          : null,
      ),
    ]);

    loaded = { studio, publishedLogoUrl, draftLogoUrl };
  } catch {
    loaded = undefined;
  }

  if (!loaded) {
    return (
      <main
        style={{
          minHeight: "100vh",
          padding: 24,
          background: "var(--ops-bg, #f7f8fa)",
          color: "var(--ops-text-1, #1d2129)",
        }}
      >
        <section
          style={{
            maxWidth: 720,
            padding: 16,
            border: "1px solid var(--ops-border, #e5e6eb)",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22 }}>品牌中心暂时无法加载</h1>
          <p style={{ margin: "8px 0 0", color: "var(--ops-text-2, #4e5969)" }}>
            请稍后刷新页面。你的线上品牌和未发布草稿不会因此改变。
          </p>
        </section>
      </main>
    );
  }

  return (
    <OrganizationBrandCenter
      initialStudio={loaded.studio}
      canEdit={loaded.studio.permissions.canManageBrand}
      initialLogoUrls={{
        published: loaded.publishedLogoUrl,
        draft: loaded.draftLogoUrl,
      }}
    />
  );
}

async function createBrandLogoSignedUrl(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;

  try {
    const bucket = getPrivateStorageBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, BRAND_LOGO_SIGNED_URL_TTL_SECONDS);
    return error || !data?.signedUrl ? null : data.signedUrl;
  } catch {
    return null;
  }
}
