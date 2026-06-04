"use server";

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
    redirect(
      `${loginBasePath}?mode=activate&next=${encodeURIComponent(next)}`,
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

  const { error: authError } = await authAdmin.updateUserById(user.id, {
    email: validation.value.email,
    phone: validation.value.phone,
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

  const { error: profileError } = await admin.from("profiles").update({
    email: validation.value.email,
    phone: validation.value.phone,
    login_account: null,
    requires_onboarding: false,
  }).eq("id", user.id);

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
    businessScale: String(formData.get("businessScale") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  if (!validation.ok) {
    redirect("/login?mode=apply&error=application");
  }

  if (!supabase) {
    redirect("/login?mode=apply&error=config");
  }

  const { error } = await supabase.from("mcn_onboarding_requests").insert({
    company_name: validation.value.companyName,
    contact_name: validation.value.contactName,
    contact_email: validation.value.contactEmail,
    contact_phone: validation.value.contactPhone,
    business_scale: validation.value.businessScale || null,
    note: validation.value.note || null,
    source: "login_page",
  });

  if (error) {
    redirect("/login?mode=apply&error=application");
  }

  redirect("/login?application=submitted");
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
