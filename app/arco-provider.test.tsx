import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@arco-design/web-react";
import { ArcoProvider } from "./arco-provider";

describe("ArcoProvider", () => {
  it("wraps app content with the shared Arco configuration", () => {
    render(
      <ArcoProvider>
        <Button type="primary">保存</Button>
      </ArcoProvider>,
    );

    const button = screen.getByRole("button", { name: "保存" });

    expect(button).toHaveClass("arco-btn-primary");
    expect(button).toHaveClass("arco-btn-size-default");
    expect(button).toHaveClass("arco-btn-two-chinese-chars");
  });
});
