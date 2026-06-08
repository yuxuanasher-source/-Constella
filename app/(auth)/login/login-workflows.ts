import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

export type LoginMode =
  | "login"
  | "reset"
  | "phone"
  | "activate"
  | "apply"
  | "help";
export type RoleIntent = "mcn" | "streamer";
export type LoginEntryPoint = "desktop" | "mobile";
export type AuthProviderAvailability = "available" | "unconfigured";

export type LoginNotice = {
  tone: "success" | "error" | "info";
  message: string;
};

export type LoginViewState = {
  mode: LoginMode;
  roleIntent: RoleIntent;
  rememberedEmail: string;
  notice: LoginNotice | null;
};

export type AuthProviderState = {
  wechat: AuthProviderAvailability;
  feishu: AuthProviderAvailability;
};

export type McnApplicationInput = {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  password: string;
  businessScale?: string;
  note?: string;
};

export type McnApplicationValidationResult =
  | { ok: true; value: Required<McnApplicationInput> }
  | {
      ok: false;
      errors: Partial<Record<keyof McnApplicationInput, string>>;
    };

export type SubaccountActivationInput = {
  email: string;
  phone: string;
  password: string;
};

export type SubaccountActivationValidationResult =
  | { ok: true; value: SubaccountActivationInput }
  | {
      ok: false;
      errors: Partial<Record<keyof SubaccountActivationInput, string>>;
    };

export function normalizeLoginMode(_value: unknown): LoginMode {
  const value = typeof _value === "string" ? _value : "";
  if (
    value === "reset" ||
    value === "phone" ||
    value === "activate" ||
    value === "apply" ||
    value === "help"
  ) {
    return value;
  }
  return "login";
}

export function normalizeRoleIntent(_value: unknown): RoleIntent {
  return _value === "streamer" ? "streamer" : "mcn";
}

export function normalizeLoginEntryPoint(_value: unknown): LoginEntryPoint {
  return _value === "mobile" ? "mobile" : "desktop";
}

export function resolvePostLoginPath(_input: {
  role: AppRole | null | undefined;
  roleIntent: RoleIntent;
  entryPoint?: LoginEntryPoint;
  next?: string;
}): string {
  const entryPoint = normalizeLoginEntryPoint(_input.entryPoint);
  const fallback = getRoleFallbackPath(
    _input.role,
    _input.roleIntent,
    entryPoint,
  );
  const safeNext = normalizeSafeNextPath(_input.next);

  if (!safeNext) {
    return fallback;
  }

  if (_input.role === "streamer") {
    return safeNext.startsWith("/m/") ||
      safeNext === "/m" ||
      safeNext === "/desktop" ||
      safeNext.startsWith("/desktop?")
      ? safeNext
      : fallback;
  }

  if (isMcnStaff(_input.role)) {
    return safeNext.startsWith("/console/") || safeNext === "/console"
      ? safeNext
      : fallback;
  }

  return fallback;
}

export function buildLoginViewState(_input: {
  searchParams: Record<string, string | undefined>;
  rememberedEmail?: string;
  rememberedRole?: string;
}): LoginViewState {
  const mode = normalizeLoginMode(_input.searchParams.mode);
  const roleIntent = normalizeRoleIntent(
    _input.searchParams.role ?? _input.rememberedRole,
  );

  return {
    mode,
    roleIntent,
    rememberedEmail: _input.rememberedEmail?.trim() ?? "",
    notice: getNotice(_input.searchParams),
  };
}

export function getAuthProviderState(_env: Record<string, string | undefined>) {
  return {
    wechat:
      _env.NEXT_PUBLIC_AUTH_WECHAT_ENABLED === "true"
        ? "available"
        : "unconfigured",
    feishu: _env.AUTH_FEISHU_LOGIN_URL ? "available" : "unconfigured",
  } satisfies AuthProviderState;
}

export function validateMcnApplicationInput(
  input: Partial<McnApplicationInput>,
): McnApplicationValidationResult {
  const value = {
    companyName: input.companyName?.trim() ?? "",
    contactName: input.contactName?.trim() ?? "",
    contactEmail: input.contactEmail?.trim().toLowerCase() ?? "",
    contactPhone: input.contactPhone?.trim() ?? "",
    password: input.password?.trim() ?? "",
    businessScale: input.businessScale?.trim() ?? "",
    note: input.note?.trim() ?? "",
  };
  const errors: Partial<Record<keyof McnApplicationInput, string>> = {};

  if (!value.companyName) {
    errors.companyName = "请输入机构名称";
  }
  if (!value.contactName) {
    errors.contactName = "请输入联系人";
  }
  if (!value.contactPhone) {
    errors.contactPhone = "请输入联系电话";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contactEmail)) {
    errors.contactEmail = "请输入有效邮箱";
  }
  if (value.password.length < 8) {
    errors.password = "密码至少 8 位";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}

export function validateSubaccountActivationInput(
  input: Partial<SubaccountActivationInput>,
): SubaccountActivationValidationResult {
  const value = {
    email: input.email?.trim().toLowerCase() ?? "",
    phone: input.phone?.trim() ?? "",
    password: input.password?.trim() ?? "",
  };
  const errors: Partial<Record<keyof SubaccountActivationInput, string>> = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
    errors.email = "请输入有效邮箱";
  }
  if (!value.phone) {
    errors.phone = "请输入联系电话";
  }
  if (value.password.length < 8) {
    errors.password = "密码至少 8 位";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return isMcnStaff(role);
}

function getRoleFallbackPath(
  role: AppRole | null | undefined,
  roleIntent: RoleIntent,
  entryPoint: LoginEntryPoint = "desktop",
) {
  if (role === "streamer") {
    return entryPoint === "mobile" ? "/m/tasks" : "/desktop";
  }
  if (isMcnStaff(role)) {
    return "/console/projects";
  }
  if (roleIntent === "streamer") {
    return entryPoint === "mobile" ? "/m/tasks" : "/desktop";
  }
  return "/console/projects";
}

function normalizeSafeNextPath(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return null;
  }
  return next;
}

function getNotice(searchParams: Record<string, string | undefined>) {
  if (searchParams.reset === "sent") {
    return {
      tone: "success",
      message: "重置邮件已发送，请查收邮箱并继续设置新密码。",
    } satisfies LoginNotice;
  }
  if (searchParams.application === "submitted") {
    return {
      tone: "success",
      message: "申请已提交，我们会在 1 个工作日内联系你完成开通。",
    } satisfies LoginNotice;
  }
  if (searchParams.registration === "completed") {
    return {
      tone: "success",
      message: "注册成功，请使用邮箱和密码登录。",
    } satisfies LoginNotice;
  }
  if (searchParams.otp === "sent") {
    return {
      tone: "success",
      message: "验证码已发送，请输入短信中的 6 位验证码。",
    } satisfies LoginNotice;
  }
  if (searchParams.activation === "completed") {
    return {
      tone: "success",
      message: "账号已激活，请使用邮箱或电话 + 新密码登录。",
    } satisfies LoginNotice;
  }
  if (searchParams.provider === "unconfigured") {
    return {
      tone: "info",
      message: "该第三方登录尚未配置，请联系管理员开通后再使用。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "config") {
    return {
      tone: "error",
      message: "Supabase 环境变量尚未配置。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "auth") {
    return {
      tone: "error",
      message: "登录失败，请检查账号或密码。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "reset") {
    return {
      tone: "error",
      message: "重置邮件发送失败，请检查邮箱或稍后重试。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "otp") {
    return {
      tone: "error",
      message: "验证码处理失败，请确认手机号和验证码是否正确。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "activation") {
    return {
      tone: "error",
      message: "账号激活失败，请检查邮箱、电话和密码后重试。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "activation-email") {
    return {
      tone: "error",
      message: "该邮箱已被其他账号绑定，请更换邮箱或联系管理员。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "activation-phone") {
    return {
      tone: "error",
      message: "该电话已被其他账号绑定，请更换电话或联系管理员。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "validation") {
    return {
      tone: "error",
      message: "注册信息校验失败，请确认邮箱、电话和至少 8 位密码。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "registration-email") {
    return {
      tone: "error",
      message: "该联系邮箱已注册，请更换邮箱或直接登录。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "registration-phone") {
    return {
      tone: "error",
      message: "该联系电话已被其他账号绑定，请更换电话或联系管理员。",
    } satisfies LoginNotice;
  }
  if (searchParams.error === "application") {
    return {
      tone: "error",
      message: "注册失败，请稍后重试或联系管理员处理。",
    } satisfies LoginNotice;
  }
  return null;
}
