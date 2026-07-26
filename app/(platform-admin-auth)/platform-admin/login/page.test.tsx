import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PlatformAdminLoginPage from "./page";

afterEach(cleanup);

describe("PlatformAdminLoginPage", () => {
  it("renders a restrained administrator-only password login", async () => {
    render(
      await PlatformAdminLoginPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "平台管理后台" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("管理员邮箱")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.getByText("机构账号无法进入此后台")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /注册|微信|飞书/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["config", "平台认证服务尚未配置"],
    ["auth", "邮箱或密码不正确"],
    ["forbidden", "当前账号没有平台管理员权限"],
  ])("shows the %s error", async (error, message) => {
    render(
      await PlatformAdminLoginPage({
        searchParams: Promise.resolve({ error }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });
});
