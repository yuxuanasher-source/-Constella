import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createKnowledgeShareRepository,
  getPublicKnowledgeShare,
} from "@/features/knowledge-base/knowledge-share";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/knowledge-base/knowledge-share", () => ({
  createKnowledgeShareRepository: vi.fn(),
  getPublicKnowledgeShare: vi.fn(),
}));
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/storage/tencent-cos", () => ({
  cosGetJson: vi.fn(),
  isCosConfigured: vi.fn(() => true),
}));

import SharedKnowledgeDocPage from "./page";

const pageSource = readFileSync(
  "app/share/kb/[token]/page.tsx",
  "utf8",
);

describe("public knowledge share page contract", () => {
  beforeEach(() => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue({} as never);
    vi.mocked(createKnowledgeShareRepository).mockReturnValue({} as never);
    vi.mocked(getPublicKnowledgeShare).mockResolvedValue(null);
  });

  it("declares noindex and noarchive metadata", () => {
    expect(pageSource).toContain("export const metadata");
    expect(pageSource).toMatch(/index:\s*false/);
    expect(pageSource).toMatch(/noarchive:\s*true/);
  });

  it("resolves public shares through hashed server metadata instead of a token COS key", () => {
    expect(pageSource).toContain("getPublicKnowledgeShare");
    expect(pageSource).not.toContain(
      "`knowledge-base-share/${token}.json`",
    );
    expect(pageSource).toContain("getSnapshot: cosGetJson");
  });

  it("keeps one indistinguishable invalid state", () => {
    expect(pageSource.match(/\u94fe\u63a5\u65e0\u6548\u6216\u5df2\u8fc7\u671f/g)?.length).toBe(1);
    expect(pageSource).not.toContain("\u5df2\u64a4\u9500");
    expect(pageSource).not.toContain("\u4e0d\u5b58\u5728");
  });

  it("continues to use the existing read-only markdown renderer", () => {
    expect(pageSource).toContain("renderMarkdownToHtml");
    expect(pageSource).toContain("dangerouslySetInnerHTML");
    expect(pageSource).not.toMatch(/contentEditable|<textarea|<input/);
  });

  it("renders an active snapshot through the existing markdown renderer", async () => {
    vi.mocked(getPublicKnowledgeShare).mockResolvedValue({
      title: "Review",
      contentMd: "# Read only\n\nEvidence",
      sharedBy: "Owner",
      createdAt: "2026-07-31T12:00:00.000Z",
      expiresAt: "2026-08-07T12:00:00.000Z",
    });

    render(
      await SharedKnowledgeDocPage({
        params: Promise.resolve({ token: Buffer.alloc(32, 7).toString("base64url") }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each(["unknown", "expired", "revoked"])(
    "renders the same invalid state for %s tokens",
    async () => {
      render(
        await SharedKnowledgeDocPage({
          params: Promise.resolve({ token: Buffer.alloc(32, 8).toString("base64url") }),
        }),
      );

      expect(
        screen.getByRole("heading", { name: "\u94fe\u63a5\u65e0\u6548\u6216\u5df2\u8fc7\u671f" }),
      ).toBeInTheDocument();
      expect(screen.getByText("\u6b64\u94fe\u63a5\u5f53\u524d\u4e0d\u53ef\u8bbf\u95ee\u3002")).toBeInTheDocument();
    },
  );
});
