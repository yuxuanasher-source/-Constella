import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "@/lib/auth/context";

import { OpsShell } from "./ops-shell";

vi.mock("@/app/(auth)/login/actions", () => ({
  signOutAction: vi.fn(),
}));

const auth: AuthContext = {
  userId: "user-1",
  email: "ops@example.test",
  name: "Ops User",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "owner",
};

describe("OpsShell", () => {
  it("exposes the AI command surface as an extension route", () => {
    render(
      <OpsShell context={auth} unreadCount={0} activeHref="/console/ai">
        <div>content</div>
      </OpsShell>,
    );

    const link = screen.getByRole("link", { name: "智能作战台" });
    expect(link).toHaveAttribute("href", "/console/ai");
    expect(link).toHaveClass("bg-[var(--blue-50)]");
  });
});
