"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Provider } from "@supabase/supabase-js";

import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

import {
  normalizeRoleIntent,
  normalizeLoginEntryPoint,
  resolvePostLoginPath,
  validateMcnApplicationInput,
  validateSubaccountActivationInput,
} from "./login-workflows";

const loginEmailCookie = "jy_login_email";
const loginRoleCookie = "jy_login_role";

export async function signInAction(formData: FormData) {
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const loginBasePath = getLoginBasePath(entryPoint);
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect(`${loginBasePath}?error=config`);
  }

  const accountIdentifier = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  const remember = formData.get("remember") === "on";
  const email = await resolvePasswordLoginEmail(accountIdentifier);
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  const context = await getAuthContext(supabase);
  if (context) {
    await writeAuditLog(supabase, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      actorName: context.name,
      actorRole: context.role,
      action: "login",
      module: "auth",
      objectType: "session",
      result: error ? "failure" : "success",
      errorMessage: error?.message,
    });
  }

  if (error) {
    redirect(`${loginBasePath}?error=auth`);
  }

  const onboarding = await getCurrentProfileOnboardingState(supabase);
  if (onboarding?.requires_onboarding) {
    const activationRoleIntent =
      context?.role === "streamer" ? "streamer" : roleIntent;
    redirect(
      `${loginBasePath}?mode=activate&role=${activationRoleIntent}&next=${encodeURIComponent(next)}`,
    );
  }

  await persistLoginPreference({
    remember,
    email: accountIdentifier,
    roleIntent,
  });

  redirect(
    resolvePostLoginPath({
      role: context?.role,
      roleIntent,
      entryPoint,
      next,
    }),
  );
}

export async function activateSubaccountAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const next = String(formData.get("next") ?? "");
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const loginBasePath = getLoginBasePath(entryPoint);
  const validation = validateSubaccountActivationInput({
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!validation.ok) {
    redirect(
      `${loginBasePath}?mode=activate&role=${roleIntent}&error=activation`,
    );
  }

  if (!supabase) {
    redirect(`${loginBasePath}?mode=activate&role=${roleIntent}&error=config`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    redirect(`${loginBasePath}?mode=activate&role=${roleIntent}&error=auth`);
  }

  const admin = createSupabaseAdminClient();
  const authAdmin = admin?.auth.admin;
  if (!admin || !authAdmin) {
    redirect(`${loginBasePath}?mode=activate&role=${roleIntent}&error=config`);
  }

  const pendingActivation = await getPendingActivationProfile(admin, user.id);
  if (!pendingActivation) {
    redirect(
      `${loginBasePath}?mode=activate&role=${roleIntent}&error=activation`,
    );
  }

  const profileConflict = await getActivationProfileConflict(admin, user.id, {
    email: validation.value.email,
    phone: validation.value.phone,
  });
  if (profileConflict) {
    redirect(
      `${loginBasePath}?mode=activate&role=${roleIntent}&error=${activationConflictError(profileConflict)}`,
    );
  }

  const authConflict = await getActivationAuthConflict(authAdmin, user.id, {
    email: validation.value.email,
    phone: validation.value.phone,
  });
  if (authConflict) {
    redirect(
      `${loginBasePath}?mode=activate&role=${roleIntent}&error=${activationConflictError(authConflict)}`,
    );
  }

  const { error: authError } = await authAdmin.updateUserById(user.id, {
    email: validation.value.email,
    phone: normalizeAuthPhone(validation.value.phone),
    password: validation.value.password,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: {
      ...(user.user_metadata ?? {}),
      onboarding_required: false,
    },
  });

  if (authError) {
    redirect(
      `${loginBasePath}?mode=activate&role=${roleIntent}&error=activation`,
    );
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      email: validation.value.email,
      phone: validation.value.phone,
      login_account: null,
      requires_onboarding: false,
    })
    .eq("id", user.id);

  if (profileError) {
    redirect(
      `${loginBasePath}?mode=activate&role=${roleIntent}&error=activation`,
    );
  }

  await supabase.auth.signOut();
  redirect(
    `${loginBasePath}?role=${roleIntent}&activation=completed&next=${encodeURIComponent(next)}`,
  );
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  redirect("/login");
}

export async function requestPasswordResetAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const loginBasePath = getLoginBasePath(entryPoint);
  const email = String(formData.get("email") ?? "").trim();

  if (!supabase) {
    redirect(`${loginBasePath}?mode=reset&role=${roleIntent}&error=config`);
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl()}${loginBasePath}?reset=sent`,
  });

  if (error) {
    redirect(`${loginBasePath}?mode=reset&role=${roleIntent}&error=reset`);
  }

  redirect(`${loginBasePath}?mode=reset&role=${roleIntent}&reset=sent`);
}

export async function requestPhoneOtpAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const loginBasePath = getLoginBasePath(entryPoint);
  const phone = String(formData.get("phone") ?? "").trim();
  const next = String(formData.get("next") ?? "");

  if (!supabase) {
    redirect(`${loginBasePath}?mode=phone&role=${roleIntent}&error=config`);
  }

  const { error } = await supabase.auth.signInWithOtp({ phone });

  if (error) {
    redirect(`${loginBasePath}?mode=phone&role=${roleIntent}&error=otp`);
  }

  redirect(
    `${loginBasePath}?mode=phone&role=${roleIntent}&otp=sent&phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}`,
  );
}

export async function verifyPhoneOtpAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const loginBasePath = getLoginBasePath(entryPoint);
  const phone = String(formData.get("phone") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const next = String(formData.get("next") ?? "");

  if (!supabase) {
    redirect(`${loginBasePath}?mode=phone&role=${roleIntent}&error=config`);
  }

  const { error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });

  if (error) {
    redirect(
      `${loginBasePath}?mode=phone&role=${roleIntent}&otp=sent&phone=${encodeURIComponent(phone)}&error=otp&next=${encodeURIComponent(next)}`,
    );
  }

  const context = await getAuthContext(supabase);
  redirect(
    resolvePostLoginPath({
      role: context?.role,
      roleIntent,
      entryPoint,
      next,
    }),
  );
}

export async function submitMcnApplicationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const validation = validateMcnApplicationInput({
    companyName: String(formData.get("companyName") ?? ""),
    contactName: String(formData.get("contactName") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    password: String(formData.get("password") ?? ""),
    businessScale: String(formData.get("businessScale") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  if (!validation.ok) {
    redirect("/login?mode=apply&error=validation");
  }

  if (!supabase) {
    redirect("/login?mode=apply&error=config");
  }

  const admin = createSupabaseAdminClient();
  const authAdmin = admin?.auth.admin;
  if (!admin || !authAdmin) {
    redirect("/login?mode=apply&error=config");
  }

  try {
    await createSelfRegisteredMcnOwner({
      admin,
      authAdmin,
      input: validation.value,
    });
  } catch (error) {
    const errorCode =
      error instanceof RegistrationActionError ? error.code : "application";
    logRegistrationFailure(error, errorCode);
    redirect(`/login?mode=apply&error=${errorCode}`);
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: validation.value.contactEmail,
    password: validation.value.password,
  });

  if (signInError) {
    redirect("/login?registration=completed");
  }

  redirect("/console/projects");
}

export async function signInWithProviderAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const loginBasePath = getLoginBasePath(entryPoint);

  if (provider === "wechat") {
    const supabase = await createSupabaseServerClient();
    if (!supabase || process.env.NEXT_PUBLIC_AUTH_WECHAT_ENABLED !== "true") {
      redirect(`${loginBasePath}?role=${roleIntent}&provider=unconfigured`);
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "wechat" as Provider,
      options: {
        redirectTo: `${getAppUrl()}${resolvePostLoginPath({
          role: roleIntent === "streamer" ? "streamer" : "owner",
          roleIntent,
          entryPoint,
        })}`,
      },
    });

    if (error || !data.url) {
      redirect(`${loginBasePath}?role=${roleIntent}&provider=unconfigured`);
    }

    redirect(data.url);
  }

  if (provider === "feishu" && process.env.AUTH_FEISHU_LOGIN_URL) {
    redirect(process.env.AUTH_FEISHU_LOGIN_URL);
  }

  redirect(`${loginBasePath}?role=${roleIntent}&provider=unconfigured`);
}

async function resolvePasswordLoginEmail(identifier: string) {
  const trimmed = identifier.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return trimmed.toLowerCase();
  }

  const { data: phoneProfile } = await admin
    .from("profiles")
    .select("email")
    .eq("phone", trimmed)
    .maybeSingle<{ email: string }>();
  if (phoneProfile?.email) {
    return phoneProfile.email;
  }

  const { data: accountProfile } = await admin
    .from("profiles")
    .select("email")
    .eq("login_account", trimmed.toLowerCase())
    .maybeSingle<{ email: string }>();
  return accountProfile?.email ?? trimmed.toLowerCase();
}

async function createSelfRegisteredMcnOwner({
  admin,
  authAdmin,
  input,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  authAdmin: NonNullable<
    ReturnType<typeof createSupabaseAdminClient>
  >["auth"]["admin"];
  input: Extract<
    ReturnType<typeof validateMcnApplicationInput>,
    { ok: true }
  >["value"];
}) {
  const profileConflict = await getRegistrationProfileConflict(admin, {
    email: input.contactEmail,
    phone: input.contactPhone,
  });
  if (profileConflict) {
    throw new RegistrationActionError(
      registrationConflictError(profileConflict),
    );
  }

  const authData = await createSelfRegistrationAuthUser({
    admin,
    authAdmin,
    input,
  });

  const user = authData.user;
  if (!user?.id) {
    throw new Error("Auth user creation returned no user");
  }

  const ownerEmail = user.email?.trim().toLowerCase() || input.contactEmail;
  let createdOrganizationId: string | null = null;

  try {
    await createSelfRegisteredMcnOwnerRecords({
      admin,
      input,
      user: { id: user.id, email: ownerEmail },
      onOrganizationCreated: (organizationId) => {
        createdOrganizationId = organizationId;
      },
    });
  } catch (error) {
    await cleanupSelfRegistrationAttempt({
      admin,
      authAdmin,
      userId: user.id,
      organizationId: createdOrganizationId,
    });
    throw error;
  }
}

async function createSelfRegistrationAuthUser({
  admin,
  authAdmin,
  input,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  authAdmin: AuthAdminClient;
  input: Extract<
    ReturnType<typeof validateMcnApplicationInput>,
    { ok: true }
  >["value"];
}) {
  const createInput = {
    email: input.contactEmail,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.contactName,
      organization_role: "owner",
      onboarding_mode: "mcn_self_registration",
      organization_name: input.companyName,
    },
  };
  const { data: authData, error: authError } =
    await authAdmin.createUser(createInput);

  if (!isAuthDuplicateEmailError(authError)) {
    throwRegistrationSupabaseError(
      authError,
      "registration-auth",
      "Auth user creation failed",
    );
    return authData;
  }

  const orphanedUser = await findOrphanedAuthUserByEmail({
    admin,
    authAdmin,
    email: input.contactEmail,
  });

  if (!orphanedUser?.id) {
    throw new RegistrationActionError("registration-email");
  }

  const { error: deleteError } = await authAdmin.deleteUser(orphanedUser.id);
  if (deleteError) {
    throw new RegistrationActionError(
      "registration-auth",
      deleteError.message ?? "Orphaned Auth user cleanup failed",
    );
  }

  const { data: retryAuthData, error: retryAuthError } =
    await authAdmin.createUser(createInput);
  throwRegistrationSupabaseError(
    retryAuthError,
    "registration-auth",
    "Auth user creation failed",
  );
  return retryAuthData;
}

async function createSelfRegisteredMcnOwnerRecords({
  admin,
  input,
  user,
  onOrganizationCreated,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  input: Extract<
    ReturnType<typeof validateMcnApplicationInput>,
    { ok: true }
  >["value"];
  user: { id: string; email: string };
  onOrganizationCreated: (organizationId: string) => void;
}) {
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .insert({
      name: input.companyName,
      code: createMcnOrganizationCode(),
    })
    .select("id, name")
    .single<{ id: string; name: string }>();
  throwRegistrationSupabaseError(
    organizationError,
    "registration-organization",
    "Organization creation failed",
  );

  if (!organization?.id) {
    throw new RegistrationActionError(
      "registration-organization",
      "Organization creation returned no organization",
    );
  }
  onOrganizationCreated(organization.id);

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      full_name: input.contactName,
      phone: input.contactPhone,
      login_account: null,
      requires_onboarding: false,
    },
    { onConflict: "id" },
  );
  throwRegistrationSupabaseError(
    profileError,
    "registration-profile",
    "Owner profile creation failed",
  );

  const { error: membershipError } = await admin
    .from("organization_members")
    .insert({
      organization_id: organization.id,
      user_id: user.id,
      role: "owner",
      status: "active",
    });
  throwRegistrationSupabaseError(
    membershipError,
    "registration-membership",
    "Owner membership creation failed",
  );
}

async function cleanupSelfRegistrationAttempt({
  admin,
  authAdmin,
  userId,
  organizationId,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  authAdmin: AuthAdminClient;
  userId: string;
  organizationId: string | null;
}) {
  if (organizationId) {
    try {
      await admin.from("organizations").delete().eq("id", organizationId);
    } catch {
      // Best-effort rollback: keep the original registration error.
    }
  }

  try {
    await authAdmin.deleteUser(userId);
  } catch {
    // Best-effort rollback: keep the original registration error.
  }
}

function createMcnOrganizationCode() {
  return `mcn-${randomUUID()}`;
}

function normalizeAuthPhone(phone: string) {
  const compact = phone.trim().replace(/[\s-]/g, "");
  if (/^1[3-9]\d{9}$/.test(compact)) {
    return `+86${compact}`;
  }
  if (compact.startsWith("+")) {
    return compact;
  }
  return phone.trim();
}

type ActivationProfileConflict = "email" | "phone" | "unknown";
type RegistrationContactConflict = "email" | "phone" | "unknown";
type RegistrationErrorCode =
  | "application"
  | "registration-email"
  | "registration-phone"
  | "registration-profile-check"
  | "registration-auth"
  | "registration-organization"
  | "registration-profile"
  | "registration-membership";
type AuthAdminClient = NonNullable<
  NonNullable<ReturnType<typeof createSupabaseAdminClient>>["auth"]["admin"]
>;

class RegistrationActionError extends Error {
  constructor(
    public readonly code: RegistrationErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "RegistrationActionError";
  }
}

type ProfileLookupError = { errorMessage: string };

function throwRegistrationSupabaseError(
  error: { message?: string } | null | undefined,
  code: RegistrationErrorCode,
  fallbackMessage: string,
) {
  if (error) {
    throw new RegistrationActionError(code, error.message ?? fallbackMessage);
  }
}

function logRegistrationFailure(error: unknown, code: RegistrationErrorCode) {
  console.warn("[auth.registration] failure", {
    code,
    errorName: getRegistrationErrorName(error),
    message: sanitizeRegistrationLogMessage(getRegistrationErrorMessage(error)),
  });
}

function getRegistrationErrorName(error: unknown) {
  if (error instanceof Error) {
    return error.name || "Error";
  }
  return typeof error;
}

function getRegistrationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown registration failure";
}

function sanitizeRegistrationLogMessage(message: string) {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /(^|[^\d])(?:\+?86[-\s]?)?1[3-9]\d(?:[\s-]?\d){8}(?!\d)/g,
      "$1[redacted-phone]",
    )
    .slice(0, 500);
}

function isProfileLookupError(
  result: boolean | ProfileLookupError,
): result is ProfileLookupError {
  return typeof result === "object";
}

async function getRegistrationProfileConflict(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  input: { email: string; phone: string },
): Promise<RegistrationContactConflict | null> {
  const emailConflict = await hasProfileWithValue(admin, "email", input.email);
  if (isProfileLookupError(emailConflict)) {
    throw new RegistrationActionError(
      "registration-profile-check",
      `Profile email lookup failed: ${emailConflict.errorMessage}`,
    );
  }
  if (emailConflict) {
    return "email";
  }

  const phoneConflict = await hasProfileWithValue(admin, "phone", input.phone);
  if (isProfileLookupError(phoneConflict)) {
    throw new RegistrationActionError(
      "registration-profile-check",
      `Profile phone lookup failed: ${phoneConflict.errorMessage}`,
    );
  }
  if (phoneConflict) {
    return "phone";
  }

  return null;
}

async function findOrphanedAuthUserByEmail({
  admin,
  authAdmin,
  email,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  authAdmin: AuthAdminClient;
  email: string;
}) {
  const profileConflict = await hasProfileWithValue(admin, "email", email);
  if (isProfileLookupError(profileConflict) || profileConflict) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 1000;

  try {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await authAdmin.listUsers({ page, perPage });

      if (error) {
        return null;
      }

      const users = data?.users ?? [];
      const matchedUser = users.find(
        (user) => user.email?.trim().toLowerCase() === normalizedEmail,
      );
      if (matchedUser?.id) {
        return matchedUser;
      }

      if (users.length < perPage) {
        break;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function getActivationProfileConflict(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string,
  input: { email: string; phone: string },
): Promise<ActivationProfileConflict | null> {
  const emailConflict = await hasOtherProfileWithValue(
    admin,
    userId,
    "email",
    input.email,
  );
  if (emailConflict === "error") {
    return "unknown";
  }
  if (emailConflict) {
    return "email";
  }

  const phoneConflict = await hasOtherProfileWithValue(
    admin,
    userId,
    "phone",
    input.phone,
  );
  if (phoneConflict === "error") {
    return "unknown";
  }
  if (phoneConflict) {
    return "phone";
  }

  return null;
}

async function getActivationAuthConflict(
  authAdmin: AuthAdminClient,
  userId: string,
  input: { email: string; phone: string },
): Promise<ActivationProfileConflict | null> {
  const email = input.email.trim().toLowerCase();
  const phoneCandidates = getAuthPhoneComparisonValues(input.phone);
  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage });

    if (error) {
      return "unknown";
    }

    const users = data?.users ?? [];
    for (const user of users) {
      if (user.id === userId) {
        continue;
      }

      if (user.email?.trim().toLowerCase() === email) {
        return "email";
      }

      const existingPhone = normalizePhoneForAuthComparison(user.phone ?? "");
      if (existingPhone && phoneCandidates.has(existingPhone)) {
        return "phone";
      }
    }

    if (users.length < perPage) {
      break;
    }
  }

  return null;
}

async function hasOtherProfileWithValue(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string,
  column: "email" | "phone",
  value: string,
): Promise<boolean | "error"> {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq(column, value)
    .neq("id", userId)
    .maybeSingle<{ id: string }>();

  if (error) {
    return "error";
  }

  return Boolean(data?.id);
}

async function hasProfileWithValue(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  column: "email" | "phone",
  value: string,
): Promise<boolean | ProfileLookupError> {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq(column, value)
    .maybeSingle<{ id: string }>();

  if (error) {
    return { errorMessage: error.message ?? `Profile ${column} lookup failed` };
  }

  return Boolean(data?.id);
}

function getAuthPhoneComparisonValues(phone: string) {
  const normalized = normalizePhoneForAuthComparison(phone);
  const candidates = new Set<string>();

  if (normalized) {
    candidates.add(normalized);
  }

  const authPhone = normalizePhoneForAuthComparison(normalizeAuthPhone(phone));
  if (authPhone) {
    candidates.add(authPhone);
  }

  if (/^86(1[3-9]\d{9})$/.test(normalized)) {
    candidates.add(normalized.slice(2));
  }

  if (/^1[3-9]\d{9}$/.test(normalized)) {
    candidates.add(`86${normalized}`);
  }

  return candidates;
}

function normalizePhoneForAuthComparison(phone: string) {
  return phone.trim().replace(/[\s-]/g, "").replace(/^\+/, "");
}

function activationConflictError(conflict: ActivationProfileConflict) {
  if (conflict === "email") {
    return "activation-email";
  }
  if (conflict === "phone") {
    return "activation-phone";
  }
  return "activation";
}

function registrationConflictError(
  conflict: RegistrationContactConflict,
): RegistrationErrorCode {
  if (conflict === "email") {
    return "registration-email";
  }
  if (conflict === "phone") {
    return "registration-phone";
  }
  return "application";
}

function isAuthDuplicateEmailError(
  error: { message?: string } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    (message.includes("email") && message.includes("registered")) ||
    message.includes("user already registered") ||
    message.includes("already been registered")
  );
}

async function getPendingActivationProfile(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string,
) {
  const { data, error } = await admin
    .from("profiles")
    .select("requires_onboarding, login_account")
    .eq("id", userId)
    .maybeSingle<{
      requires_onboarding: boolean;
      login_account: string | null;
    }>();

  if (error) {
    return null;
  }

  if (!data?.requires_onboarding || !data.login_account?.trim()) {
    return null;
  }

  return data;
}

async function getCurrentProfileOnboardingState(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return null;
  }

  const { data } = await supabase
    .from("profiles")
    .select("requires_onboarding")
    .eq("id", user.id)
    .maybeSingle<{ requires_onboarding: boolean }>();

  return data;
}

async function persistLoginPreference(input: {
  remember: boolean;
  email: string;
  roleIntent: "mcn" | "streamer";
}) {
  const cookieStore = await cookies();

  if (!input.remember) {
    cookieStore.delete(loginEmailCookie);
    cookieStore.delete(loginRoleCookie);
    return;
  }

  const maxAge = 60 * 60 * 24 * 7;
  cookieStore.set(loginEmailCookie, input.email.trim(), {
    httpOnly: true,
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  cookieStore.set(loginRoleCookie, input.roleIntent, {
    httpOnly: true,
    sameSite: "lax",
    maxAge,
    path: "/",
  });
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getLoginBasePath(entryPoint: "desktop" | "mobile") {
  return entryPoint === "mobile" ? "/m/login" : "/login";
}
