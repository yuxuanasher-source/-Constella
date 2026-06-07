import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  listAdmissionProjectRecordings,
  toAdmissionRecordingExportRows,
} from "@/features/applications/admission-board";
import { createGovernedExport } from "@/features/exports/export-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/applications/admission-board", () => ({
  listAdmissionProjectRecordings: vi.fn(),
  toAdmissionRecordingExportRows: vi.fn(),
}));

vi.mock("@/features/exports/export-service", () => ({
  createGovernedExport: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@example.com",
  name: "Ops",
  organizationId: "org-1",
  organizationName: "Org",
  role: "ops_manager" as const,
};

const recordingDetails = [
  {
    id: "app-1",
    source: "signup" as const,
    status: "recording_reviewing" as const,
    submittedAt: "2026-06-07T01:00:00.000Z",
    decisionReason: null,
    project: {
      id: "project-1",
      code: "P-001",
      name: "Alpha",
      status: "active",
      vendor: "Vendor",
      product: "Game",
    },
    streamer: {
      id: "streamer-1",
      displayName: "Streamer",
      accountLabel: "Douyin / streamer",
      cooperationStatus: "active",
      riskLevel: "low",
    },
    latestRecording: {
      id: "rec-1",
      version: 1,
      status: "submitted" as const,
      durationSeconds: 3600,
      url: "https://video.example/rec-1",
      hasPrivateStorage: false,
      submittedAt: "2026-06-07T01:10:00.000Z",
    },
    vendorReview: null,
  },
];

describe("admission recordings export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(listAdmissionProjectRecordings).mockResolvedValue(
      recordingDetails,
    );
    vi.mocked(toAdmissionRecordingExportRows).mockReturnValue([
      {
        projectCode: "P-001",
        projectName: "Alpha",
        streamerName: "Streamer",
      },
    ]);
    vi.mocked(createGovernedExport).mockResolvedValue({
      kind: "admission_recordings",
      filename: "admission_recordings-2026-06-07.csv",
      content: "Project code\nP-001",
      fieldCount: 11,
      rowCount: 1,
    });
  });

  it("exports server-side admission rows for a project", async () => {
    const response = await POST(
      new Request("http://localhost/api/exports/admission-recordings", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          rows: [{ projectCode: "forged" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      export: {
        kind: "admission_recordings",
        filename: "admission_recordings-2026-06-07.csv",
        content: "Project code\nP-001",
        fieldCount: 11,
        rowCount: 1,
      },
    });
    expect(listAdmissionProjectRecordings).toHaveBeenCalledWith(
      { client: "supabase" },
      "project-1",
    );
    expect(toAdmissionRecordingExportRows).toHaveBeenCalledWith(
      recordingDetails,
    );
    expect(createGovernedExport).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      kind: "admission_recordings",
      rows: [
        {
          projectCode: "P-001",
          projectName: "Alpha",
          streamerName: "Streamer",
        },
      ],
    });
  });

  it("requires a project id", async () => {
    const response = await POST(
      new Request("http://localhost/api/exports/admission-recordings", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(createGovernedExport).not.toHaveBeenCalled();
  });

  it("blocks streamers", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/exports/admission-recordings", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-1" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createGovernedExport).not.toHaveBeenCalled();
  });
});
