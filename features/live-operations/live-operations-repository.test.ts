import { describe, expect, it, vi } from "vitest";

import {
  getStreamerIdForUser,
  SupabaseLiveOperationsRepository,
} from "./live-operations-repository";

describe("getStreamerIdForUser", () => {
  it("selects one streamer binding within the current organization", async () => {
    const limit = vi.fn(async () => ({
      data: [{ id: "streamer-latest" }],
      error: null,
    }));
    const orderId = vi.fn(() => ({ limit }));
    const orderCreatedAt = vi.fn(() => ({ order: orderId }));
    const eqOrganization = vi.fn(() => ({ order: orderCreatedAt }));
    const eqUser = vi.fn(() => ({ eq: eqOrganization }));
    const select = vi.fn(() => ({ eq: eqUser }));
    const from = vi.fn(() => ({ select }));

    await expect(
      getStreamerIdForUser({ from } as never, "user-streamer", "org-1"),
    ).resolves.toBe("streamer-latest");
    expect(from).toHaveBeenCalledWith("streamers");
    expect(select).toHaveBeenCalledWith("id");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-streamer");
    expect(eqOrganization).toHaveBeenCalledWith("organization_id", "org-1");
    expect(orderCreatedAt).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(orderId).toHaveBeenCalledWith("id", { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
  });
});

describe("SupabaseLiveOperationsRepository", () => {
  it("returns the database-generated report screenshot id", async () => {
    const single = vi.fn(async () => ({
      data: { id: "screenshot-db-1" },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const repo = new SupabaseLiveOperationsRepository({ from } as never);

    await expect(
      repo.createReportScreenshot({
        organizationId: "org-1",
        liveReportId: "report-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        storagePath: "org/report-screenshots/task-1/end.png",
        fileHash: "sha256:abc123",
        uploadedBy: "user-streamer",
        metadata: { imageBucket: "evidence-private" },
      }),
    ).resolves.toEqual({ id: "screenshot-db-1" });

    expect(from).toHaveBeenCalledWith("report_screenshots");
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      live_report_id: "report-1",
      project_id: "project-1",
      streamer_id: "streamer-1",
      storage_path: "org/report-screenshots/task-1/end.png",
      file_hash: "sha256:abc123",
      uploaded_by: "user-streamer",
      metadata: { imageBucket: "evidence-private" },
    });
    expect(select).toHaveBeenCalledWith("id");
    expect(single).toHaveBeenCalledOnce();
  });
});
