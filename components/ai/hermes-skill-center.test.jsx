import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HermesSkillCenter from "./hermes-skill-center";

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe("HermesSkillCenter", () => {
  it("renders the governed read-only Skill catalog", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        kernelId: "hermes-agent-fork",
        role: "finance",
        enabledSkillIds: ["business-context", "settlement-analysis"],
        skills: [
          {
            skillId: "business-context",
            displayName: "Business Context",
            enabled: true,
            reason: "granted",
          },
          {
            skillId: "project-review",
            displayName: "Project Review",
            enabled: false,
            reason: "role_not_allowed",
          },
        ],
      }),
    );

    render(<HermesSkillCenter fetcher={fetcher} />);

    await waitFor(() =>
      expect(screen.getByText("Hermes Skills")).toBeInTheDocument(),
    );
    expect(screen.getByText(/finance/)).toBeInTheDocument();
    expect(screen.getByText("Business Context")).toBeInTheDocument();
    expect(screen.getByText("Project Review")).toBeInTheDocument();
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText("角色未授权")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /安装|启用|停用/ })).toBeNull();
    expect(fetcher).toHaveBeenCalledWith("/api/ai/hermes/skills");
  });

  it("shows the safe error returned by the catalog endpoint", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Only MCN staff can inspect Xingyao AI Skills" }, false),
    );

    render(<HermesSkillCenter fetcher={fetcher} />);

    await waitFor(() =>
      expect(
        screen.getByText("Only MCN staff can inspect Xingyao AI Skills"),
      ).toBeInTheDocument(),
    );
  });
});
