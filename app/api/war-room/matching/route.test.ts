import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { loadCastingCandidates } from "@/features/streamers/casting-candidate-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/features/streamers/casting-candidate-loader", () => ({
  loadCastingCandidates: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

const trustedCandidate = {
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
  profileInsights: [],
  referenceProjects: [],
};

describe("war room matching route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadCastingCandidates).mockResolvedValue({
      candidates: [trustedCandidate],
      dataGaps: [],
    });
  });

  it("loads trusted candidate metrics server-side from authenticated organization", async () => {
    const client = { client: "supabase" };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

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
          candidateIds: ["streamer-a"],
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
    expect(loadCastingCandidates).toHaveBeenCalledWith(client, {
      organizationId: "org-1",
      requiredMinutes: 600,
      candidateIds: ["streamer-a"],
    });
    await expect(response.json()).resolves.toMatchObject({
      matches: [{ streamerId: "streamer-a" }],
      suppliers: [{ supplierId: "supplier-a", grade: "A" }],
      dataGaps: [],
    });
  });

  it("uses server-loaded metric gaps without coercing them to passing values", async () => {
    vi.mocked(loadCastingCandidates).mockResolvedValue({
      candidates: [
        {
          ...trustedCandidate,
          id: "streamer-gap",
          name: "Gap",
          categories: [],
          platforms: [],
          styles: [],
          completionRateBps: null,
          screeningPassRateBps: null,
          roiBps: null,
          grossMarginContributionCents: null,
          availableMinutes: 0,
        },
      ],
      dataGaps: [
        "candidate_completion_rate",
        "candidate_screening_pass_rate",
      ],
    });

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
          candidateIds: ["streamer-gap"],
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
      dataGaps: [
        "candidate_completion_rate",
        "candidate_screening_pass_rate",
      ],
    });
  });

  it("rejects forged client candidate metrics instead of trusting them", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/matching", {
        method: "POST",
        body: JSON.stringify({
          project: {
            category: "moba",
            platform: "douyin",
            preferredStyles: [],
            requiredMinutes: 600,
          },
          candidateIds: ["streamer-a"],
          candidates: [
            {
              id: "streamer-a",
              screeningPassRateBps: 10000,
              completionRateBps: 10000,
            },
          ],
          suppliers: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(loadCastingCandidates).not.toHaveBeenCalled();
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

  it("rejects invalid matching request bodies before loading candidates", async () => {
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
          candidateIds: [],
          suppliers: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
    expect(loadCastingCandidates).not.toHaveBeenCalled();
  });
});
