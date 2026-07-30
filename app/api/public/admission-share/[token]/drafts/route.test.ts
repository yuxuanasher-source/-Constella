import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  listPublicAdmissionReviewDrafts,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

vi.mock(
  "@/features/applications/admission-share-board",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/applications/admission-share-board")
      >();
    return {
      ...actual,
      SupabaseAdmissionShareBoardRepository: vi
        .fn()
        .mockImplementation(function () {
          return { repo: "share-repo" };
        }),
      listPublicAdmissionReviewDrafts: vi.fn(),
    };
  },
);

vi.mock("@/features/applications/admission-share-access-store", () => ({
  SupabaseAdmissionShareAccessStore: vi.fn().mockImplementation(function () {
    return { store: "access-store" };
  }),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/http/admission-share-access-session", () => ({
  readAdmissionShareAccessSession: vi.fn(),
}));

const params = Promise.resolve({ token: "plain-token" });
const supabase = { client: "service-role" };

describe("public admission share drafts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    vi.mocked(listPublicAdmissionReviewDrafts).mockResolvedValue([
      {
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        decision: "backup",
        remark: "保留作为备选",
        reasonCodes: ["account_fit"],
        revision: 4,
        updatedAt: "2026-07-30T08:30:00.000Z",
        organizationId: "must-not-leak",
        shareBoardId: "must-not-leak",
      },
    ] as never);
  });

  it("returns a whitelisted draft DTO after token and HttpOnly session gating", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/drafts?accessCode=must-not-be-read",
      ),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      drafts: [
        {
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          decision: "backup",
          remark: "保留作为备选",
          reasonCodes: ["account_fit"],
          revision: 4,
          updatedAt: "2026-07-30T08:30:00.000Z",
        },
      ],
    });
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(listPublicAdmissionReviewDrafts).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
    });
    expect(readAdmissionShareAccessSession).toHaveBeenCalledWith(
      expect.any(Request),
      "plain-token",
    );
  });

  it("fails closed when the service-role client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/drafts",
      ),
      { params },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SHARE_SERVICE_UNAVAILABLE",
    });
    expect(listPublicAdmissionReviewDrafts).not.toHaveBeenCalled();
  });
});
