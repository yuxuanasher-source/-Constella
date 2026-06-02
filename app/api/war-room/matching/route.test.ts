import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("war room matching route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns ranked streamer matches and supplier scores for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/matching", {
        method: "POST",
        body: JSON.stringify({
          project: {
            category: "moba",
            platform: "douyin",
            preferredStyles: ["高互动"],
            requiredMinutes: 600,
          },
          candidates: [
            {
              id: "streamer-a",
              name: "Ava",
              categories: ["moba"],
              platforms: ["douyin"],
              styles: ["高互动"],
              completionRateBps: 9000,
              screeningPassRateBps: 9000,
              roiBps: 13000,
              grossMarginContributionCents: 100000,
              riskTags: [],
              availableMinutes: 900,
              referenceProjects: [],
            },
          ],
          suppliers: [
            {
              id: "supplier-a",
              name: "星河公会",
              screeningPassRateBps: 9000,
              completionRateBps: 8500,
              marginContributionCents: 1500000,
              anomalyRateBps: 500,
              blacklistRateBps: 0,
              isBlacklisted: false,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      matches: [{ streamerId: "streamer-a" }],
      suppliers: [{ supplierId: "supplier-a", grade: "A" }],
    });
  });

  it("blocks streamers from internal matching risk notes", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/war-room/matching", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
  });
});
