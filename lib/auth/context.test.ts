import { describe, expect, it, vi } from "vitest";

import { getAuthContext } from "./context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
}

describe("getAuthContext", () => {
  it("loads profile and active membership in parallel after resolving the session user", async () => {
    const profileResult = deferred<{
      data: { full_name: string; requires_onboarding: boolean };
      error: null;
    }>();
    const membershipResult = deferred<{
      data: {
        organization_id: string;
        role: "streamer";
        organizations: { name: string };
      };
      error: null;
    }>();

    const profileQuery = {
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(() => profileResult.promise),
    };
    const membershipQuery = {
      eq: vi.fn(() => membershipQuery),
      order: vi.fn(() => membershipQuery),
      limit: vi.fn(() => membershipQuery),
      maybeSingle: vi.fn(() => membershipResult.promise),
    };
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => profileQuery),
        };
      }
      if (table === "organization_members") {
        return {
          select: vi.fn(() => membershipQuery),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: { id: "user-1", email: "streamer@example.cn" },
          },
        })),
      },
      from,
    };

    const contextPromise = getAuthContext(client as never);
    await Promise.resolve();

    const membershipWasRequestedBeforeProfileResolved = from.mock.calls
      .map(([table]) => table)
      .includes("organization_members");

    profileResult.resolve({
      data: { full_name: "Ada", requires_onboarding: true },
      error: null,
    });
    membershipResult.resolve({
      data: {
        organization_id: "org-1",
        role: "streamer",
        organizations: { name: "Org One" },
      },
      error: null,
    });

    await expect(contextPromise).resolves.toMatchObject({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Ada",
      organizationId: "org-1",
      organizationName: "Org One",
      role: "streamer",
      requiresOnboarding: true,
    });
    expect(membershipWasRequestedBeforeProfileResolved).toBe(true);
  });
});
