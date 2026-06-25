import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

import {
  activateSubaccountAction,
  signInAction,
  signInWithProviderAction,
  submitMcnApplicationAction,
} from "./actions";

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

  it("redirects failed password sign-ins before loading organization context", async () => {
    const failedSignIn = vi.fn(async () => ({
      error: { message: "Invalid login credentials" },
    }));
    const serverFrom = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword: failedSignIn, getUser, signOut },
      from: serverFrom,
    } as never);

    await expect(
      signInAction(
        form({
          email: "ops@example.cn",
          password: "WrongSecret",
          roleIntent: "mcn",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login?error=auth");

    expect(getAuthContext).not.toHaveBeenCalled();
    expect(serverFrom).not.toHaveBeenCalled();
  });

  it("does not persist a guessed role preference during automatic role routing", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
      organizationName: "Org 1",
      requiresOnboarding: false,
    } as never);
    const serverFrom = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword, getUser, signOut },
      from: serverFrom,
    } as never);

    await expect(
      signInAction(
        form({
          email: "streamer@example.cn",
          password: "Secret123",
          remember: "on",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/desktop");

    expect(setCookie).toHaveBeenCalledWith(
      "jy_login_email",
      "streamer@example.cn",
      expect.any(Object),
    );
    expect(setCookie).not.toHaveBeenCalledWith(
      "jy_login_role",
      expect.anything(),
      expect.anything(),
    );
  });

  it("uses the login auth context onboarding flag without a second profile lookup", async () => {
    const serverFrom = vi.fn();
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "ops@example.cn",
      name: "Ops",
      role: "owner",
      organizationId: "org-1",
      organizationName: "Org 1",
      requiresOnboarding: false,
    } as never);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword, getUser, signOut },
      from: serverFrom,
    } as never);

    await expect(
      signInAction(
        form({
          email: "ops@example.cn",
          password: "Secret123",
          roleIntent: "mcn",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/console/projects");

    expect(serverFrom).not.toHaveBeenCalled();
  });

  it("preserves the authenticated streamer role when redirecting to activation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
      organizationName: "Org 1",
    });
    const serverFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { requires_onboarding: true },
            error: null,
          })),
        })),
      })),
    }));
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword, getUser, signOut },
      from: serverFrom,
    } as never);

    await expect(
      signInAction(
        form({
          email: "streamer@example.cn",
          password: "Secret123",
          roleIntent: "mcn",
          next: "/console/projects",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?mode=activate&role=streamer&next=%2Fconsole%2Fprojects",
    );
  });

  it("returns from unconfigured provider login without a manual role query", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    await expect(
      signInWithProviderAction(
        form({
          provider: "wechat",
          entryPoint: "desktop",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login?provider=unconfigured");
  });

  it("routes configured mobile WeChat OAuth through the callback with mobile streamer intent", async () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const wechatEnabled = process.env.NEXT_PUBLIC_AUTH_WECHAT_ENABLED;
    process.env.NEXT_PUBLIC_APP_URL = "https://preview.example.cn";
    process.env.NEXT_PUBLIC_AUTH_WECHAT_ENABLED = "true";
    const signInWithOAuth = vi.fn(
      async (input: { options?: { redirectTo?: string } }) => {
        void input;
        return {
          data: { url: "https://wechat.example/oauth" },
          error: null,
        };
      },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithOAuth },
    } as never);

    try {
      await expect(
        signInWithProviderAction(
          form({
            provider: "wechat",
            roleIntent: "streamer",
            entryPoint: "mobile",
            next: "/m/tasks",
          }),
        ),
      ).rejects.toThrow("NEXT_REDIRECT:https://wechat.example/oauth");
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = appUrl;
      process.env.NEXT_PUBLIC_AUTH_WECHAT_ENABLED = wechatEnabled;
    }

    const redirectTo = signInWithOAuth.mock.calls[0]?.[0].options?.redirectTo;
    expect(redirectTo).toBeTruthy();
    const callback = new URL(String(redirectTo));
    expect(callback.origin).toBe("https://preview.example.cn");
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("entryPoint")).toBe("mobile");
    expect(callback.searchParams.get("roleIntent")).toBe("streamer");
    expect(callback.searchParams.get("next")).toBe("/m/tasks");
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

  it("normalizes mainland phone numbers for Auth while activating streamer subaccounts", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser, signOut },
    } as never);
    const updateUserById = vi.fn(async () => ({ error: null }));
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const updateProfile = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));
    const adminFrom = vi.fn(() => ({
      select: vi.fn((columns: string) => ({
        eq:
          columns === "requires_onboarding, login_account"
            ? vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    requires_onboarding: true,
                    login_account: "jy-sub-001",
                  },
                  error: null,
                })),
              }))
            : vi.fn(() => ({
                neq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
                    error: null,
                  })),
                })),
              })),
      })),
      update: updateProfile,
    }));
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { updateUserById, listUsers } },
      from: adminFrom,
    } as never);

    await expect(
      activateSubaccountAction(
        form({
          email: "streamer@example.cn",
          phone: "13800138000",
          password: "Secret123",
          roleIntent: "streamer",
          entryPoint: "mobile",
          next: "/m/tasks",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/m/login?role=streamer&activation=completed&next=%2Fm%2Ftasks",
    );

    expect(updateUserById).toHaveBeenCalledWith("user-1", {
      email: "streamer@example.cn",
      phone: "+8613800138000",
      password: "Secret123",
      email_confirm: true,
      phone_confirm: true,
      user_metadata: {
        onboarding_required: false,
      },
    });
    expect(updateProfile).toHaveBeenCalledWith({
      email: "streamer@example.cn",
      phone: "13800138000",
      login_account: null,
      requires_onboarding: false,
    });
    expect(signOut).toHaveBeenCalled();
  });

  it("does not enumerate Auth users during activation and maps duplicate phone update errors", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser, signOut },
    } as never);
    const updateUserById = vi.fn(async () => ({
      error: { message: "A user with this phone already exists" },
    }));
    const listUsers = vi.fn(async () => {
      throw new Error("activation should not scan the Auth user table");
    });
    const updateProfile = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));
    const adminFrom = vi.fn(() => ({
      select: vi.fn((columns: string) => ({
        eq:
          columns === "requires_onboarding, login_account"
            ? vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    requires_onboarding: true,
                    login_account: "jy-sub-001",
                  },
                  error: null,
                })),
              }))
            : vi.fn(() => ({
                neq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
                    error: null,
                  })),
                })),
              })),
      })),
      update: updateProfile,
    }));
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { updateUserById, listUsers } },
      from: adminFrom,
    } as never);

    await expect(
      activateSubaccountAction(
        form({
          email: "streamer@example.cn",
          phone: "18083748097",
          password: "Secret123",
          roleIntent: "streamer",
          entryPoint: "mobile",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/m/login?mode=activate&role=streamer&error=activation-phone",
    );

    expect(listUsers).not.toHaveBeenCalled();
    expect(updateUserById).toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("rejects activation before updating Auth when the phone belongs to another profile", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser, signOut },
    } as never);
    const updateUserById = vi.fn(async () => ({ error: null }));
    const updateProfile = vi.fn(() => ({
      eq: vi.fn(async () => ({
        error: {
          message: "duplicate key value violates unique constraint",
        },
      })),
    }));
    const adminFrom = vi.fn(() => ({
      select: vi.fn((columns: string) => ({
        eq:
          columns === "requires_onboarding, login_account"
            ? vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    requires_onboarding: true,
                    login_account: "jy-sub-001",
                  },
                  error: null,
                })),
              }))
            : vi.fn((column: string) => ({
                neq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: column === "phone" ? { id: "other-user" } : null,
                    error: null,
                  })),
                })),
              })),
      })),
      update: updateProfile,
    }));
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { updateUserById } },
      from: adminFrom,
    } as never);

    await expect(
      activateSubaccountAction(
        form({
          email: "streamer@example.cn",
          phone: "18083748097",
          password: "Secret123",
          roleIntent: "streamer",
          entryPoint: "mobile",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/m/login?mode=activate&role=streamer&error=activation-phone",
    );

    expect(updateUserById).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("self-registers an MCN organization, makes the user owner, and signs them in", async () => {
    const serverSignIn = vi.fn(async () => ({ error: null }));
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword: serverSignIn },
    } as never);

    const createUser = vi.fn(async () => ({
      data: {
        user: { id: "user-new", email: "owner@example.cn" },
      },
      error: null,
    }));
    const insertOrganization = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "org-new", name: "星耀互动" },
          error: null,
        })),
      })),
    }));
    const upsertProfile = vi.fn(async () => ({ error: null }));
    const insertMembership = vi.fn(async () => ({ error: null }));
    const insertOnboardingRequest = vi.fn(async () => ({ error: null }));
    const adminFrom = vi.fn((table: string) => {
      if (table === "organizations") {
        return { insert: insertOrganization };
      }
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          upsert: upsertProfile,
        };
      }
      if (table === "organization_members") {
        return { insert: insertMembership };
      }
      return { insert: insertOnboardingRequest };
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser } },
      from: adminFrom,
    } as never);

    await expect(
      submitMcnApplicationAction(
        form({
          companyName: " 星耀互动 ",
          contactName: " 林经理 ",
          contactEmail: " OWNER@example.cn ",
          contactPhone: "13800138000",
          password: "Secret123",
          businessScale: "20-50 streamers",
          note: "需要结算协同",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/console/projects");

    expect(createUser).toHaveBeenCalledWith({
      email: "owner@example.cn",
      password: "Secret123",
      email_confirm: true,
      user_metadata: {
        full_name: "林经理",
        organization_role: "owner",
        onboarding_mode: "mcn_self_registration",
        organization_name: "星耀互动",
      },
    });
    expect(insertOrganization).toHaveBeenCalledWith({
      name: "星耀互动",
      code: expect.stringMatching(/^mcn-[0-9a-f-]+$/),
    });
    expect(upsertProfile).toHaveBeenCalledWith(
      {
        id: "user-new",
        email: "owner@example.cn",
        full_name: "林经理",
        phone: "13800138000",
        login_account: null,
        requires_onboarding: false,
      },
      { onConflict: "id" },
    );
    expect(insertMembership).toHaveBeenCalledWith({
      organization_id: "org-new",
      user_id: "user-new",
      role: "owner",
      status: "active",
    });
    expect(insertOnboardingRequest).not.toHaveBeenCalled();
    expect(serverSignIn).toHaveBeenCalledWith({
      email: "owner@example.cn",
      password: "Secret123",
    });
  });

  it("rejects MCN self-registration before Auth creation when contact email is already bound", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword },
    } as never);

    const createUser = vi.fn();
    const adminFrom = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string) => ({
              maybeSingle: vi.fn(async () => ({
                data: column === "email" ? { id: "existing-user" } : null,
                error: null,
              })),
            })),
          })),
          upsert: vi.fn(async () => ({ error: null })),
        };
      }
      return { insert: vi.fn(async () => ({ error: null })) };
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser } },
      from: adminFrom,
    } as never);

    await expect(
      submitMcnApplicationAction(
        form({
          companyName: "星耀互动",
          contactName: "林经理",
          contactEmail: "owner@example.cn",
          contactPhone: "13800138000",
          password: "Secret123",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?mode=apply&error=registration-email",
    );

    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects MCN self-registration before Auth creation when contact phone is already bound", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword },
    } as never);

    const createUser = vi.fn();
    const adminFrom = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((column: string) => ({
              maybeSingle: vi.fn(async () => ({
                data: column === "phone" ? { id: "existing-user" } : null,
                error: null,
              })),
            })),
          })),
          upsert: vi.fn(async () => ({
            error: {
              message: "duplicate key value violates unique constraint",
            },
          })),
        };
      }
      return { insert: vi.fn(async () => ({ error: null })) };
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser } },
      from: adminFrom,
    } as never);

    await expect(
      submitMcnApplicationAction(
        form({
          companyName: "星耀互动",
          contactName: "林经理",
          contactEmail: "owner@example.cn",
          contactPhone: "13800138000",
          password: "Secret123",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?mode=apply&error=registration-phone",
    );

    expect(createUser).not.toHaveBeenCalled();
  });

  it("reports an Auth duplicate email as a registration email conflict", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword },
    } as never);

    const createUser = vi.fn(async () => ({
      data: { user: null },
      error: {
        message: "A user with this email address has already been registered",
      },
    }));
    const adminFrom = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          upsert: vi.fn(async () => ({ error: null })),
        };
      }
      return { insert: vi.fn(async () => ({ error: null })) };
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser } },
      from: adminFrom,
    } as never);

    await expect(
      submitMcnApplicationAction(
        form({
          companyName: "星耀互动",
          contactName: "林经理",
          contactEmail: "owner@example.cn",
          contactPhone: "13800138000",
          password: "Secret123",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?mode=apply&error=registration-email",
    );
  });

  it("recovers an orphaned Auth user before retrying MCN self-registration", async () => {
    const serverSignIn = vi.fn(async () => ({ error: null }));
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword: serverSignIn },
    } as never);

    const createUser = vi
      .fn()
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: "User already registered" },
      })
      .mockResolvedValueOnce({
        data: {
          user: { id: "user-new", email: "owner@example.cn" },
        },
        error: null,
      });
    const listUsers = vi.fn(async () => ({
      data: {
        users: [{ id: "orphan-user", email: "owner@example.cn" }],
      },
      error: null,
    }));
    const deleteUser = vi.fn(async () => ({ error: null }));
    const insertOrganization = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "org-new", name: "Star Ops" },
          error: null,
        })),
      })),
    }));
    const upsertProfile = vi.fn(async () => ({ error: null }));
    const insertMembership = vi.fn(async () => ({ error: null }));
    const adminFrom = vi.fn((table: string) => {
      if (table === "organizations") {
        return { insert: insertOrganization };
      }
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          upsert: upsertProfile,
        };
      }
      if (table === "organization_members") {
        return { insert: insertMembership };
      }
      return { insert: vi.fn(async () => ({ error: null })) };
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser, listUsers } },
      from: adminFrom,
    } as never);

    await expect(
      submitMcnApplicationAction(
        form({
          companyName: "Star Ops",
          contactName: "Lin Manager",
          contactEmail: "owner@example.cn",
          contactPhone: "13800138000",
          password: "Secret123",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/console/projects");

    expect(deleteUser).toHaveBeenCalledWith("orphan-user");
    expect(createUser).toHaveBeenCalledTimes(2);
    expect(upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-new", email: "owner@example.cn" }),
      { onConflict: "id" },
    );
    expect(serverSignIn).toHaveBeenCalledWith({
      email: "owner@example.cn",
      password: "Secret123",
    });
  });

  it("rolls back the Auth user and organization when profile creation fails", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithPassword },
    } as never);

    const createUser = vi.fn(async () => ({
      data: {
        user: { id: "user-new", email: "owner@example.cn" },
      },
      error: null,
    }));
    const deleteUser = vi.fn(async () => ({ error: null }));
    const insertOrganization = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "org-new", name: "星耀互动" },
          error: null,
        })),
      })),
    }));
    const deleteOrganization = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));
    const upsertProfile = vi.fn(async () => ({
      error: { message: "profile write failed" },
    }));
    const insertMembership = vi.fn(async () => ({ error: null }));
    const adminFrom = vi.fn((table: string) => {
      if (table === "organizations") {
        return { insert: insertOrganization, delete: deleteOrganization };
      }
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          upsert: upsertProfile,
        };
      }
      return { insert: insertMembership };
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser } },
      from: adminFrom,
    } as never);

    await expect(
      submitMcnApplicationAction(
        form({
          companyName: "星耀互动",
          contactName: "林经理",
          contactEmail: "owner@example.cn",
          contactPhone: "13800138000",
          password: "Secret123",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login?mode=apply&error=application");

    expect(deleteOrganization).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("user-new");
    expect(insertMembership).not.toHaveBeenCalled();
  });
});
