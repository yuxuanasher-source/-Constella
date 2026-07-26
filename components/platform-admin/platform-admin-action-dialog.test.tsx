import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlatformAdminActionDialog } from "./platform-admin-action-dialog";

describe("PlatformAdminActionDialog", () => {
  it("renders an accessible portal dialog and closes with Escape", () => {
    const onClose = vi.fn();

    render(
      <PlatformAdminActionDialog
        open
        title="冻结组织"
        description="冻结后组织成员将无法继续操作。"
        submitting={false}
        onClose={onClose}
      >
        <label>
          操作原因
          <input aria-label="操作原因" defaultValue="风险处置" />
        </label>
      </PlatformAdminActionDialog>,
    );

    expect(
      screen.getByRole("dialog", { name: "冻结组织" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("操作原因")).toHaveValue("风险处置");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open while submitting and exposes conflict recovery", () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn();

    render(
      <PlatformAdminActionDialog
        open
        title="调整套餐"
        submitting
        error="数据已被其他管理员更新，请刷新后重试。"
        conflict
        onClose={onClose}
        onRefresh={onRefresh}
      >
        <input aria-label="调整原因" defaultValue="客户升级" />
      </PlatformAdminActionDialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("调整原因")).toHaveValue("客户升级");
    fireEvent.click(screen.getByRole("button", { name: "刷新最新数据" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "数据已被其他管理员更新",
    );
  });
});
