import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export const dynamic = "force-dynamic";

type RegistrationResidueRequest = {
  action?: unknown;
  confirm?: unknown;
  email?: unknown;
  phone?: unknown;
  token?: unknown;
};

type ProfileResidue = {
  id: string;
  email: string | null;
  phone: string | null;
  login_account: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AuthResidue = {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as
    | RegistrationResidueRequest
    | Record<string, unknown>;

  return handleResidueRequest(request, body);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handleResidueRequest(request, {
    action: url.searchParams.get("action") ?? undefined,
    confirm: url.searchParams.get("confirm") ?? undefined,
    email: url.searchParams.get("email") ?? undefined,
    phone: url.searchParams.get("phone") ?? undefined,
    token: url.searchParams.get("token") ?? undefined,
  });
}

async function handleResidueRequest(
  request: Request,
  body: RegistrationResidueRequest | Record<string, unknown>,
) {
  if (!hasMaintenanceAccess(request, optionalString(body.token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const authAdmin = admin?.auth.admin;
  if (!admin || !authAdmin) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured" },
      { status: 500 },
    );
  }

  const email = optionalEmail(body.email);
  const phone = optionalString(body.phone);

  if (!email && !phone) {
    return NextResponse.json(
      { error: "email or phone is required" },
      { status: 400 },
    );
  }

  const profiles = await findProfiles(admin, { email, phone });
  const authUsers = await findAuthUsers(authAdmin, { email, phone });
  const membershipByUserId = await findMemberships(admin, [
    ...profiles.map((profile) => profile.id),
    ...authUsers.map((user) => user.id),
  ]);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const cleanupCandidates = [
    ...profiles
      .filter((profile) => !membershipByUserId.has(profile.id))
      .map((profile) => ({ id: profile.id, source: "profile" as const })),
    ...authUsers
      .filter(
        (user) => !membershipByUserId.has(user.id) && !profileIds.has(user.id),
      )
      .map((user) => ({ id: user.id, source: "auth" as const })),
  ];

  const action = optionalString(body.action) ?? "inspect";
  let cleanup: { authDeleted: number; profilesDeleted: number } | null = null;

  if (action === "cleanup") {
    const confirmation = optionalString(body.confirm);
    if (confirmation !== cleanupConfirmation(cleanupCandidates.map((c) => c.id))) {
      return NextResponse.json(
        {
          error: "cleanup confirmation is invalid",
          expectedConfirmation: cleanupConfirmation(
            cleanupCandidates.map((c) => c.id),
          ),
        },
        { status: 400 },
      );
    }

    cleanup = await cleanupResidue(
      admin,
      cleanupCandidates.map((candidate) => candidate.id),
    );
  } else if (action !== "inspect") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  return NextResponse.json({
    action,
    cleanup,
    lookup: {
      email: email ? maskEmail(email) : null,
      phone: phone ? maskPhone(phone) : null,
    },
    counts: {
      authUsers: authUsers.length,
      profiles: profiles.length,
      memberships: membershipByUserId.size,
      cleanupCandidates: cleanupCandidates.length,
    },
    cleanupCandidates: cleanupCandidates.map((candidate) => ({
      idHash: hashId(candidate.id),
      source: candidate.source,
    })),
    confirmation: cleanupConfirmation(cleanupCandidates.map((c) => c.id)),
    authUsers: authUsers.map((user) => ({
      idHash: hashId(user.id),
      email: maskEmail(user.email ?? null),
      phone: maskPhone(user.phone ?? null),
      hasMembership: membershipByUserId.has(user.id),
      created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
    })),
    profiles: profiles.map((profile) => ({
      idHash: hashId(profile.id),
      email: maskEmail(profile.email),
      phone: maskPhone(profile.phone),
      login_account: profile.login_account ? "[present]" : null,
      hasMembership: membershipByUserId.has(profile.id),
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    })),
  });
}

function hasMaintenanceAccess(request: Request, queryToken?: string) {
  const token = process.env.REGISTRATION_MAINTENANCE_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const provided = queryToken ?? authorization.replace(/^Bearer\s+/i, "");

  return typeof token === "string" && safeEqual(provided, token);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

async function findProfiles(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  input: { email?: string; phone?: string },
) {
  const filters = [
    input.email ? `email.eq.${input.email}` : null,
    input.email ? `login_account.eq.${input.email}` : null,
    input.phone ? `phone.eq.${input.phone}` : null,
    input.phone ? `login_account.eq.${input.phone}` : null,
  ].filter(Boolean);

  if (filters.length === 0) {
    return [];
  }

  const { data, error } = await admin
    .from("profiles")
    .select("id,email,phone,login_account,created_at,updated_at")
    .or(filters.join(","));

  if (error) {
    throw error;
  }

  return (data ?? []) as ProfileResidue[];
}

async function findAuthUsers(
  authAdmin: NonNullable<
    ReturnType<typeof createSupabaseAdminClient>
  >["auth"]["admin"],
  input: { email?: string; phone?: string },
) {
  const phoneCandidates = new Set(
    [input.phone, input.phone ? normalizeAuthPhone(input.phone) : undefined]
      .filter(Boolean)
      .map((value) => normalizePhoneForComparison(value as string)),
  );
  const users: AuthResidue[] = [];
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await authAdmin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    for (const user of data.users ?? []) {
      const authEmail = (user.email ?? "").toLowerCase();
      const authPhone = normalizePhoneForComparison(user.phone ?? "");
      if (
        (input.email && authEmail === input.email) ||
        (authPhone && phoneCandidates.has(authPhone))
      ) {
        users.push({
          id: user.id,
          email: user.email,
          phone: user.phone,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
        });
      }
    }

    if ((data.users ?? []).length < perPage) {
      break;
    }
    page += 1;
  }

  return users;
}

async function findMemberships(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userIds: string[],
) {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await admin
    .from("organization_members")
    .select("user_id")
    .in("user_id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Set((data ?? []).map((row) => row.user_id as string));
}

async function cleanupResidue(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userIds: string[],
) {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) {
    return { authDeleted: 0, profilesDeleted: 0 };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .in("id", uniqueIds);

  if (profileError) {
    throw profileError;
  }

  let authDeleted = 0;
  for (const id of uniqueIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) {
      authDeleted += 1;
    }
  }

  return { authDeleted, profilesDeleted: uniqueIds.length };
}

function optionalEmail(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : undefined;
}

function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAuthPhone(phone: string) {
  const compact = phone.trim().replace(/[\s-]/g, "");
  if (/^1\d{10}$/.test(compact)) {
    return `+86${compact}`;
  }

  return phone.trim();
}

function normalizePhoneForComparison(phone: string) {
  return phone.trim().replace(/[\s-]/g, "").replace(/^\+/, "");
}

function cleanupConfirmation(ids: string[]) {
  if (ids.length === 0) {
    return "cleanup:none";
  }

  return `cleanup:${createHash("sha256")
    .update(ids.sort().join(":"))
    .digest("hex")
    .slice(0, 12)}`;
}

function hashId(id: string) {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

function maskEmail(email: string | null | undefined) {
  if (!email) {
    return null;
  }

  const [name, domain] = email.split("@");
  if (!name || !domain) {
    return "***";
  }

  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) {
    return null;
  }

  const compact = phone.replace(/\s+/g, "");
  if (compact.length <= 4) {
    return "***";
  }

  return `${compact.slice(0, 3)}****${compact.slice(-4)}`;
}
