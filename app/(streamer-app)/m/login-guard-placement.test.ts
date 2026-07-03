import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 回归护栏：未登录访问 /m/login 曾出现无限 307 自我重定向——鉴权 layout
// 把登录页也包了进去（中间件放行后由页面守卫触发循环）。登录页必须留在
// (protected) 路由组之外，守卫只能放在 (protected)/layout.tsx。
const mDir = join(process.cwd(), "app", "(streamer-app)", "m");

describe("streamer mobile login guard placement", () => {
  it("keeps /m/login outside the (protected) route group", () => {
    expect(existsSync(join(mDir, "login", "page.tsx"))).toBe(true);
    expect(existsSync(join(mDir, "(protected)", "login"))).toBe(false);
  });

  it("never auth-guards a layout that wraps the login page", () => {
    const sharedLayout = join(mDir, "layout.tsx");
    if (existsSync(sharedLayout)) {
      expect(readFileSync(sharedLayout, "utf8")).not.toContain(
        "requireAuthenticatedUser",
      );
    }
  });

  it("guards every protected page via the (protected) layout", () => {
    const layout = readFileSync(
      join(mDir, "(protected)", "layout.tsx"),
      "utf8",
    );
    expect(layout).toContain('requireAuthenticatedUser("/m/login")');
    for (const page of ["tasks", "me", "diagnosis", "recordings"]) {
      expect(existsSync(join(mDir, "(protected)", page, "page.tsx"))).toBe(
        true,
      );
    }
  });
});
