import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

import { activateSubaccountAction, signInAction } from "./actions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const deleteCookie = vi.fn();
const setCookie = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    delete: deleteCookie,
    set: setCookie,
    get: vi.fn(),
  })),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

function createProfileLookup(
  rowsByColumn: Record<string, { email?: string } | null>,
) {
  return vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn((column: string) => ({
        maybeSingle: vi.fn(async () => ({
          data: rowsByColumn[column] ?? null,
          error: null,
        })),
      })),
    })),
  }));
}

describe("login server actions", () => {
  const signInWithPassword = vi.fn(async () => ({ error: null }));
  const signOut = vi.fn(async () => ({ error: null }));
  const getUser = vi.fn(async () => ({
    data: { user: { id: "user-1", user_metadata: {} } },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    deleteCookie.mockClear();
    setCookie.mockClear();

    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "ops@example.cn",
      name: "Ops",
      role: "owner",
      organizationId: "org-1",
      organizationName: "Org 1",
    });
  });

  it("resolves default login accounts through the admin client before password sign-in", async () => {
    const serverFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { requires_onboarding: false },
            error: null,
          })),
        })),
      })),
    }));
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword, getUser, signOut },
      from: serverFrom,
    } as never);
    const adminFrom = createProfileLookup({
      phone: null,
      login_account: { email: "sub@example.cn" },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: adminFrom,
    } as never);

    await expect(
      signInAction(
        form({
          email: " sub-account ",
          password: "Secret123",
          roleIntent: "mcn",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/console/projects");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "sub@example.cn",
      password: "Secret123",
    });
    expect(serverFrom).toHaveBeenCalledTimes(1);
    expect(adminFrom).toHaveBeenCalled();
  });

  it("rejects activation unless the current profile is a pending subaccount", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser, signOut },
    } as never);
    const updateUserById = vi.fn(async () => ({ error: null }));
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { requires_onboarding: false, login_account: null },
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    } as never);

    await expect(
      activateSubaccountAction(
        form({
          email: "normal@example.cn",
          phone: "13800138000",
          password: "Secret123",
          roleIntent: "mcn",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?mode=activate&role=mcn&error=activation",
    );

    expect(updateUserById).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
