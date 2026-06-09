import { beforeEach, describe, expect, it, vi } from "vitest";

import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  countUnreadNotificationCenterItems,
  listNotificationCenterItems,
} from "@/features/notifications/notification-center-queries";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
import { listStreamerRecordingLinks } from "@/features/recordings/streamer-recording-library";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import StreamerDesktopPage from "./page";

vi.mock("@/components/reference-ui/streamer-desktop-reference", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listStreamerTaskCards: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-repository", () => ({
  getStreamerIdForUser: vi.fn(),
}));

vi.mock("@/features/notifications/notification-center-queries", () => ({
  countUnreadNotificationCenterItems: vi.fn(),
  listNotificationCenterItems: vi.fn(),
}));

vi.mock("@/features/recordings/project-announcements", () => ({
  listStreamerProjectAnnouncements: vi.fn(),
}));

vi.mock("@/features/recordings/streamer-recording-library", () => ({
  listStreamerRecordingLinks: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-queries", () => ({
  getStreamerProfileRow: vi.fn(),
}));

vi.mock("@/features/streamers/streamer-ui-dto", () => ({
  toStreamerDesktopProfileDto: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("StreamerDesktopPage data loading", () => {
  const supabase = { from: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
      organizationName: "Org One",
    });
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(listStreamerTaskCards).mockResolvedValue([]);
    vi.mocked(listNotificationCenterItems).mockResolvedValue([]);
    vi.mocked(countUnreadNotificationCenterItems).mockResolvedValue(0);
    vi.mocked(getStreamerProfileRow).mockResolvedValue({} as never);
    vi.mocked(toStreamerDesktopProfileDto).mockReturnValue({
      id: "streamer-1",
      alias: "Streamer",
    } as never);
    vi.mocked(listStreamerRecordingLinks).mockResolvedValue([]);
    vi.mocked(listStreamerProjectAnnouncements).mockResolvedValue([]);
  });

  it("reuses one authenticated streamer context for all dashboard data", async () => {
    await StreamerDesktopPage();

    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(getAuthContext).toHaveBeenCalledTimes(1);
    expect(getStreamerIdForUser).toHaveBeenCalledTimes(1);
    expect(listStreamerTaskCards).toHaveBeenCalledWith(supabase, "streamer-1");
    expect(listStreamerRecordingLinks).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      streamerId: "streamer-1",
    });
    expect(listStreamerProjectAnnouncements).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      streamerId: "streamer-1",
    });
  });
});
