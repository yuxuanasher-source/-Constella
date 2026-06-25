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
      data: Array<{
        organization_id: string;
        role: string;
        organizations: { name: string };
      }>;
      error: null;
    }>();

    const profileQuery = {
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(() => profileResult.promise),
    };
    const membershipQuery = {
      eq: vi.fn(() => membershipQuery),
      order: vi.fn(() => membershipQuery),
      returns: vi.fn(() => membershipResult.promise),
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
      data: [
        {
          organization_id: "org-1",
          role: "streamer",
          organizations: { name: "Org One" },
        },
      ],
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

  it("resolves the most privileged role when a user holds multiple roles in one org", async () => {
    const membershipQuery = {
      eq: vi.fn(() => membershipQuery),
      order: vi.fn(() => membershipQuery),
      returns: vi.fn(async () => ({
        // Same org, both active — streamer row returned first.
        data: [
          {
            organization_id: "org-9",
            role: "streamer",
            organizations: { name: "Org Nine" },
          },
          {
            organization_id: "org-9",
            role: "owner",
            organizations: { name: "Org Nine" },
          },
        ],
        error: null,
      })),
    };
    const profileQuery = {
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(async () => ({
        data: { full_name: "Boss", requires_onboarding: false },
        error: null,
      })),
    };
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-9", email: "boss@example.cn" } },
        })),
      },
      from: vi.fn((table: string) =>
        table === "profiles"
          ? { select: vi.fn(() => profileQuery) }
          : { select: vi.fn(() => membershipQuery) },
      ),
    };

    await expect(getAuthContext(client as never)).resolves.toMatchObject({
      organizationId: "org-9",
      role: "owner",
    });
  });
});
