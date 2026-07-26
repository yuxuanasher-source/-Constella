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

  it("accepts explicit candidate metric gaps without coercing them to zero", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/matching", {
        method: "POST",
        body: JSON.stringify({
          project: {
            category: "moba",
            platform: "douyin",
            preferredStyles: [],
            requiredMinutes: 0,
          },
          candidates: [
            {
              id: "streamer-gap",
              name: "Gap",
              categories: [],
              platforms: [],
              styles: [],
              completionRateBps: null,
              screeningPassRateBps: null,
              roiBps: null,
              grossMarginContributionCents: null,
              riskTags: [],
              availableMinutes: 0,
              referenceProjects: [],
            },
          ],
          suppliers: [],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      matches: [
        {
          streamerId: "streamer-gap",
          riskNotes: expect.arrayContaining([
            "completion_rate_unavailable",
            "screening_pass_rate_unavailable",
            "roi_unavailable",
            "gross_margin_contribution_unavailable",
          ]),
        },
      ],
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

  it("rejects invalid matching request bodies before scoring", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/matching", {
        method: "POST",
        body: JSON.stringify({
          project: {
            category: 123,
            platform: "douyin",
            preferredStyles: ["高互动"],
            requiredMinutes: 600,
          },
          candidates: [],
          suppliers: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
  });
});
