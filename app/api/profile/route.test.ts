import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

function buildSupabase(row: {
  avatar_text?: string | null;
  avatar_url?: string | null;
}) {
  const maybeSingle = vi.fn(async () => ({
    data: {
      id: "user-1",
      avatar_text: row.avatar_text ?? null,
      avatar_url: row.avatar_url ?? null,
    },
    error: null,
  }));
  const eq = vi.fn(() => ({
    select: vi.fn(() => ({ maybeSingle })),
  }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from }, update, eq };
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA";
const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

describe("PATCH /api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      name: "123",
      role: "owner",
      organizationId: "org-1",
    } as never);
  });

  it("updates the caller's avatar text through the session client", async () => {
    const supabase = buildSupabase({ avatar_text: "🚀" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ avatarText: "🚀" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: { id: "user-1", avatarText: "🚀", avatarUrl: "" },
    });
    expect(supabase.update).toHaveBeenCalledWith({ avatar_text: "🚀" });
    expect(supabase.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("clears the avatar text when an empty string is submitted", async () => {
    const supabase = buildSupabase({ avatar_text: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ avatarText: "  " }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: { id: "user-1", avatarText: "", avatarUrl: "" },
    });
    expect(supabase.update).toHaveBeenCalledWith({ avatar_text: null });
  });

  it("stores a compressed jpeg avatar image and clears the text mark together", async () => {
    const supabase = buildSupabase({ avatar_text: null, avatar_url: JPEG_DATA_URL });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(
      jsonRequest({ avatarText: "", avatarUrl: JPEG_DATA_URL }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: { id: "user-1", avatarText: "", avatarUrl: JPEG_DATA_URL },
    });
    expect(supabase.update).toHaveBeenCalledWith({
      avatar_text: null,
      avatar_url: JPEG_DATA_URL,
    });
  });

  it("accepts a png data URL and clears the image when an empty string is submitted", async () => {
    const supabase = buildSupabase({ avatar_url: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const pngResponse = await PATCH(jsonRequest({ avatarUrl: PNG_DATA_URL }));
    expect(pngResponse.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith({ avatar_url: PNG_DATA_URL });

    const clearResponse = await PATCH(jsonRequest({ avatarUrl: "" }));
    expect(clearResponse.status).toBe(200);
    expect(supabase.update).toHaveBeenLastCalledWith({ avatar_url: null });
  });

  it("rejects avatar text longer than 4 code points", async () => {
    const supabase = buildSupabase({});
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ avatarText: "星耀经营舱长" }));

    expect(response.status).toBe(400);
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("rejects avatar URLs that are not jpeg/png data URLs", async () => {
    const supabase = buildSupabase({});
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(
      jsonRequest({ avatarUrl: "https://evil.example.com/a.svg" }),
    );

    expect(response.status).toBe(400);
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("rejects a request with neither field", async () => {
    const supabase = buildSupabase({});
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ avatarText: "🚀" }));

    expect(response.status).toBe(401);
  });
});
