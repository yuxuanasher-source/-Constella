import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandStoryPanel, McnApplicationForm } from "./page";

describe("login page brand story panel", () => {
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
