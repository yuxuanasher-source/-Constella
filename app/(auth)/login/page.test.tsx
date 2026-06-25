import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
  })),
}));

import LoginPage, { BrandStoryPanel, McnApplicationForm } from "./page";

describe("password login page", () => {
  it("does not ask users to choose a role before sign-in", async () => {
    const { container } = render(
      await LoginPage({ searchParams: Promise.resolve({}) }),
    );

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.querySelectorAll('input[name="roleIntent"]')).toHaveLength(
      0,
    );
  });
});

describe("login page brand story panel", () => {
  it("does not show the compact brand lockup in the top corner", () => {
    render(<BrandStoryPanel />);

    expect(screen.queryByText("星耀传媒")).not.toBeInTheDocument();
    expect(screen.queryByText("报数与结算工作台")).not.toBeInTheDocument();
  });

  it("does not show business metric floating cards", () => {
    render(<BrandStoryPanel />);

    expect(screen.queryByText("本月毛利")).not.toBeInTheDocument();
    expect(screen.queryByText("¥0")).not.toBeInTheDocument();
    expect(screen.queryByText("待审核报数")).not.toBeInTheDocument();
    expect(screen.queryByText("1 笔")).not.toBeInTheDocument();
    expect(screen.queryByText("须处理")).not.toBeInTheDocument();
  });
});

describe("MCN registration form", () => {
  it("requires an 8-character password before submit", () => {
    render(<McnApplicationForm />);

    expect(screen.getByLabelText("登录密码")).toHaveAttribute("minlength", "8");
  });
});
