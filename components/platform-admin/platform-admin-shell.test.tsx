import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlatformAdminShell } from "./platform-admin-shell";

describe("PlatformAdminShell", () => {
  it("renders an independent platform-administration navigation", () => {
    render(
      <PlatformAdminShell
        currentPath="/platform-admin/organizations"
        administratorName="平台管理员"
      >
        <div>工作区</div>
      </PlatformAdminShell>,
    );

    expect(screen.getByText("平台管理后台")).toBeInTheDocument();
    for (const label of [
      "经营总览",
      "组织",
      "全部用户",
      "套餐",
      "订单与付款",
      "成本模型",
      "操作审计",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText("切换组织")).not.toBeInTheDocument();
  });
});
