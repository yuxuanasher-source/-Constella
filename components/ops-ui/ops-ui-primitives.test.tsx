import { render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./icon-button";
import { TableShell } from "./table";
import { Tabs } from "./tabs";

describe("ops-ui primitives", () => {
  it("renders icon-only buttons with an accessible name", () => {
    render(
      <IconButton label="搜索">
        <Search aria-hidden="true" />
      </IconButton>,
    );

    expect(screen.getByRole("button", { name: "搜索" })).toBeInTheDocument();
  });

  it("renders tabs with selected state and click handling", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="projects"
        onChange={onChange}
        items={[
          { value: "overview", label: "总览" },
          { value: "projects", label: "项目" },
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: "项目" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    screen.getByRole("tab", { name: "总览" }).click();

    expect(onChange).toHaveBeenCalledWith("overview");
  });

  it("renders a stable table shell with column headers and rows", () => {
    render(
      <TableShell
        columns={[
          { key: "name", header: "名称" },
          { key: "status", header: "状态" },
        ]}
        rows={[
          { id: "row-1", name: "Alpha", status: "进行中" },
          { id: "row-2", name: "Beta", status: "待处理" },
        ]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "名称" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});
