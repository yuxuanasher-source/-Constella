import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StreamerMobileLoginPanel } from "./page";

describe("streamer mobile login page", () => {
  it("renders a mobile-only streamer login entry with mobile redirect intent", () => {
    const { container } = render(
      <StreamerMobileLoginPanel
        mode="login"
        rememberedEmail="anchor@example.cn"
        next=""
        phone=""
        otpSent={false}
        providers={{ wechat: "unconfigured", feishu: "unconfigured" }}
        notice={null}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "主播移动端登录" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("主播账号")).toHaveValue("anchor@example.cn");
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.queryByText("我是 MCN 运营")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "电脑端登录" })).toHaveAttribute(
      "href",
      "/login?role=streamer",
    );
    expect(container.querySelector('input[name="roleIntent"]')).toHaveAttribute(
      "value",
      "streamer",
    );
    expect(container.querySelector('input[name="entryPoint"]')).toHaveAttribute(
      "value",
      "mobile",
    );
    expect(container.querySelector('input[name="next"]')).toHaveAttribute(
      "value",
      "",
    );
    const entryPointValues = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'form input[name="entryPoint"]',
      ),
      (input) => input.value,
    );
    const roleIntentValues = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'form input[name="roleIntent"]',
      ),
      (input) => input.value,
    );
    expect(entryPointValues.length).toBeGreaterThanOrEqual(3);
    expect(new Set(entryPointValues)).toEqual(new Set(["mobile"]));
    expect(roleIntentValues.length).toBe(entryPointValues.length);
    expect(new Set(roleIntentValues)).toEqual(new Set(["streamer"]));
  });
});
