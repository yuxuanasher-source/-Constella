import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listOpsApplicationQueue } from "@/features/applications/application-queries";
import {
  getOpsSettlementDefaultScope,
  listOpsSettlementBatches,
  listOpsSettlementBatchDetails,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";
import { getAuthContext } from "@/lib/auth/context";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import StubPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn((props: { currentUser?: { name?: string } }) => (
    <div data-testid="ops-reference-app">
      {props.currentUser?.name ?? "missing-user"}
    </div>
  )),
}));

vi.mock("@/features/applications/application-queries", () => ({
  listOpsApplicationQueue: vi.fn(),
}));

vi.mock("@/features/audit-center/audit-center-queries", () => ({
  listAuditCenterEntries: vi.fn(),
}));

vi.mock("@/features/billing/billing-status", () => ({
  getBillingStatus: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listOpsLiveReportQueue: vi.fn(),
  listOpsLiveTaskQueue: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-queries", () => ({
  getOpsSettlementDefaultScope: vi.fn(),
  listOpsSettlementBatches: vi.fn(),
  listOpsSettlementBatchDetails: vi.fn(),
  listOpsSettlementPool: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-queries", () => ({
  listStreamerPool: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: vi.fn(() => "jy-private"),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("console module stubs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the authenticated staff identity into the ops UI", async () => {
    const logoStoragePath =
      "11111111-1111-4111-8111-111111111111/brand-logos/33333333-3333-4333-8333-333333333333.webp";
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.example/stub-logo.webp" },
      error: null,
    });
    const from = vi.fn(() => ({ createSignedUrl }));
    const supabase = { storage: { from } };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-finance",
      email: "finance@example.test",
      name: "Finance User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      organizationBranding: {
        schemaVersion: 1,
        version: 3,
        logoText: "DO",
        logoStoragePath,
        brandName: "Demo Org",
        brandTagline: "Trusted",
        primaryColor: "#123456",
        actionColor: "#123456",
        softColor: "#E3E7EB",
        publishedAt: "2026-08-01T00:00:00.000Z",
        semantic: {
          success: "#00B42A",
          warning: "#FF7D00",
          danger: "#F53F3F",
          info: "#165DFF",
        },
      },
      role: "finance",
    });

    render(await StubPage({ params: Promise.resolve({ module: "m1" }) }));

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Finance User",
    );
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "projects",
        currentUser: expect.objectContaining({
          id: "user-finance",
          name: "Finance User",
          role: "finance",
          dept: "Demo Org",
        }),
        organizationSettings: expect.objectContaining({
          name: "Demo Org",
          logoStoragePath: null,
          logoUrl: "https://signed.example/stub-logo.webp",
          brand: expect.objectContaining({ logoStoragePath: null }),
        }),
      }),
      undefined,
    );
    expect(getPrivateStorageBucket).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("jy-private");
    expect(createSignedUrl).toHaveBeenCalledWith(logoStoragePath, 120);
    expect(
      JSON.stringify(vi.mocked(OpsReferenceApp).mock.calls[0][0]),
    ).not.toContain(logoStoragePath);
  });

  it("redirects unauthenticated visitors to login", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    await expect(
      Promise.resolve().then(() =>
        StubPage({ params: Promise.resolve({ module: "m1" }) }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("hydrates the settlement module with org-scoped batch reads", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-finance",
      email: "finance@example.test",
      name: "Finance User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "finance",
    });
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);
    vi.mocked(listOpsSettlementBatchDetails).mockResolvedValue({});
    vi.mocked(getOpsSettlementDefaultScope).mockResolvedValue(null);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);

    render(await StubPage({ params: Promise.resolve({ module: "m6" }) }));

    expect(listOpsSettlementBatches).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsSettlementBatchDetails).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
    });
    expect(getOpsSettlementDefaultScope).toHaveBeenCalledWith(
      supabase,
      "org-1",
    );
    expect(listOpsSettlementPool).not.toHaveBeenCalled();
  });

  it("m3 no longer prefetches the application queue during SSR", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ops",
      email: "ops@example.test",
      name: "Ops User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "ops_manager",
    });

    render(await StubPage({ params: Promise.resolve({ module: "m3" }) }));

    // B6：报名队列改为客户端挂载后经 /api/applications 拉取。
    expect(listOpsApplicationQueue).not.toHaveBeenCalled();
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({ initialRoute: "admission" }),
      undefined,
    );
    const props = vi.mocked(OpsReferenceApp).mock.calls[0][0] as {
      applicationQueue?: unknown;
    };
    expect(props.applicationQueue).toBeUndefined();
  });
});
