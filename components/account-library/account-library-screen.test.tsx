import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountLibraryScreen } from "./account-library-screen";

describe("AccountLibraryScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finishes loading when React replays effects in strict mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accounts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <AccountLibraryScreen active canManage />
      </StrictMode>,
    );

    expect(
      await screen.findByRole("heading", { name: "账号库" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads once on first activation and preserves panel state across scene switches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accounts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <AccountLibraryScreen active={false} canManage />,
    );

    expect(fetchMock).not.toHaveBeenCalled();

    rerender(<AccountLibraryScreen active canManage />);

    expect(
      await screen.findByRole("heading", { name: "账号库" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account-library",
      expect.objectContaining({ cache: "no-store" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    expect(screen.getByRole("button", { name: "保存账号" })).toBeVisible();

    rerender(<AccountLibraryScreen active={false} canManage />);
    expect(
      screen.getByRole("heading", { name: "账号库", hidden: true }),
    ).not.toBeVisible();

    rerender(<AccountLibraryScreen active canManage />);
    expect(screen.getByRole("button", { name: "保存账号" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error when the account request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "账号服务暂不可用" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accounts: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountLibraryScreen active canManage={false} />);

    expect(await screen.findByText("账号服务暂不可用")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "账号库" })).toBeVisible();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
