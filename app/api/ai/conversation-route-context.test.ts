import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();
const getAuthContextMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: getAuthContextMock,
}));

describe("AI conversation route context", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseServerClientMock.mockReset();
    createSupabaseAdminClientMock.mockReset();
    getAuthContextMock.mockReset();
  });

  it("requires an authenticated Supabase session", async () => {
    createSupabaseServerClientMock.mockResolvedValue(null);
    const { getAiConversationRouteContext } = await import(
      "./conversation-route-context"
    );

    const result = await getAiConversationRouteContext();

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("Expected Response");
    expect(result.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects streamer accounts before creating an admin client", async () => {
    createSupabaseServerClientMock.mockResolvedValue({});
    getAuthContextMock.mockResolvedValue({
      userId: "streamer-1",
      organizationId: "org-1",
      role: "streamer",
    });
    const { getAiConversationRouteContext } = await import(
      "./conversation-route-context"
    );

    const result = await getAiConversationRouteContext();

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("Expected Response");
    expect(result.status).toBe(403);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("fails closed when the service-role client is unavailable", async () => {
    createSupabaseServerClientMock.mockResolvedValue({});
    getAuthContextMock.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "ops_manager",
    });
    createSupabaseAdminClientMock.mockReturnValue(null);
    const { getAiConversationRouteContext } = await import(
      "./conversation-route-context"
    );

    const result = await getAiConversationRouteContext();

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("Expected Response");
    expect(result.status).toBe(503);
  });
});
