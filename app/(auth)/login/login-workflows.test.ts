import { describe, expect, it } from "vitest";

import {
  buildLoginViewState,
  getAuthProviderState,
  normalizeLoginEntryPoint,
  normalizeLoginMode,
  normalizeRoleIntent,
  resolvePostLoginPath,
  validateSubaccountActivationInput,
  validateMcnApplicationInput,
} from "./login-workflows";

describe("login workflows", () => {
  it("routes authenticated MCN staff and streamers to their real workspaces", () => {
    expect(
      resolvePostLoginPath({ role: "owner", roleIntent: "streamer" }),
    ).toBe("/console/projects");
    expect(
      resolvePostLoginPath({ role: "operator_business", roleIntent: "mcn" }),
    ).toBe("/console/projects");
    expect(resolvePostLoginPath({ role: "streamer", roleIntent: "mcn" })).toBe(
      "/desktop",
    );
    expect(
      resolvePostLoginPath({
        role: "streamer",
        roleIntent: "streamer",
        entryPoint: "mobile",
      }),
    ).toBe("/m/tasks");
    expect(
      resolvePostLoginPath({
        role: "streamer",
        roleIntent: "streamer",
        entryPoint: "desktop",
      }),
    ).toBe("/desktop");
  });

  it("allows only role-appropriate internal next paths after login", () => {
    expect(
      resolvePostLoginPath({
        role: "owner",
        roleIntent: "mcn",
        next: "/console/stubs/m3",
      }),
    ).toBe("/console/stubs/m3");
    expect(
      resolvePostLoginPath({
        role: "streamer",
        roleIntent: "streamer",
        next: "/m/recordings",
      }),
    ).toBe("/m/recordings");
    expect(
      resolvePostLoginPath({
        role: "streamer",
        roleIntent: "streamer",
        next: "/desktop",
        entryPoint: "mobile",
      }),
    ).toBe("/desktop");
    expect(
      resolvePostLoginPath({
        role: "owner",
        roleIntent: "mcn",
        next: "https://evil.test/console",
      }),
    ).toBe("/console/projects");
    expect(
      resolvePostLoginPath({
        role: "streamer",
        roleIntent: "streamer",
        next: "/console/projects",
        entryPoint: "mobile",
      }),
    ).toBe("/m/tasks");
  });

  it("normalizes login modes and role intent from query values", () => {
    expect(normalizeLoginMode("reset")).toBe("reset");
    expect(normalizeLoginMode("phone")).toBe("phone");
    expect(normalizeLoginMode("activate")).toBe("activate");
    expect(normalizeLoginMode("apply")).toBe("apply");
    expect(normalizeLoginMode("unknown")).toBe("login");
    expect(normalizeRoleIntent("streamer")).toBe("streamer");
    expect(normalizeRoleIntent("anything")).toBe("mcn");
    expect(normalizeLoginEntryPoint("mobile")).toBe("mobile");
    expect(normalizeLoginEntryPoint("desktop")).toBe("desktop");
    expect(normalizeLoginEntryPoint("anything")).toBe("desktop");
  });

  it("builds view state from query params and remembered cookie values", () => {
    expect(
      buildLoginViewState({
        searchParams: { mode: "reset", reset: "sent" },
        rememberedEmail: "ops@example.cn",
        rememberedRole: "streamer",
      }),
    ).toMatchObject({
      mode: "reset",
      roleIntent: "streamer",
      rememberedEmail: "ops@example.cn",
      notice: {
        tone: "success",
        message: "重置邮件已发送，请查收邮箱并继续设置新密码。",
      },
    });
  });

  it("reports configured and unavailable third-party auth providers", () => {
    expect(
      getAuthProviderState({
        NEXT_PUBLIC_AUTH_WECHAT_ENABLED: "true",
        AUTH_FEISHU_LOGIN_URL: "https://sso.example.cn/login",
      }),
    ).toEqual({
      wechat: "available",
      feishu: "available",
    });
    expect(getAuthProviderState({})).toEqual({
      wechat: "unconfigured",
      feishu: "unconfigured",
    });
  });

  it("validates and normalizes MCN onboarding requests", () => {
    const result = validateMcnApplicationInput({
      companyName: " 星耀互动 ",
      contactName: " 林经理 ",
      contactEmail: "ops@example.cn",
      contactPhone: "13800138000",
      businessScale: "20-50 streamers",
      note: "需要结算协同",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        companyName: "星耀互动",
        contactName: "林经理",
        contactEmail: "ops@example.cn",
        contactPhone: "13800138000",
        businessScale: "20-50 streamers",
        note: "需要结算协同",
      },
    });

    expect(
      validateMcnApplicationInput({
        companyName: "",
        contactName: "",
        contactEmail: "bad-email",
        contactPhone: "",
      }),
    ).toEqual({
      ok: false,
      errors: {
        companyName: "请输入机构名称",
        contactName: "请输入联系人",
        contactEmail: "请输入有效邮箱",
        contactPhone: "请输入联系电话",
      },
    });
  });

  it("validates first-login activation for generated subaccounts", () => {
    expect(
      validateSubaccountActivationInput({
        email: " sub@example.com ",
        phone: " 13800138000 ",
        password: "NewPass8",
      }),
    ).toEqual({
      ok: true,
      value: {
        email: "sub@example.com",
        phone: "13800138000",
        password: "NewPass8",
      },
    });

    expect(
      validateSubaccountActivationInput({
        email: "bad",
        phone: "",
        password: "short",
      }),
    ).toEqual({
      ok: false,
      errors: {
        email: "请输入有效邮箱",
        phone: "请输入联系电话",
        password: "密码至少 8 位",
      },
    });
  });
});
