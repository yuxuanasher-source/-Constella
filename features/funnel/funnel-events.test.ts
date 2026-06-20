import { describe, expect, it, vi } from "vitest";

import { recordFunnelEvent } from "./funnel-events";

describe("recordFunnelEvent", () => {
  it("maps the event to a funnel_events row", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ insert })) };

    await recordFunnelEvent(client, {
      event: "paywall_shown",
      organizationId: "org-1",
      userId: "user-1",
      reason: "usage_hard_block",
      properties: { metric: "ocr" },
    });

    expect(client.from).toHaveBeenCalledWith("funnel_events");
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      user_id: "user-1",
      anonymous_id: null,
      event: "paywall_shown",
      reason: "usage_hard_block",
      variant: null,
      properties: { metric: "ocr" },
    });
  });

  it("supports pre-signup anonymous events", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ insert })) };

    await recordFunnelEvent(client, {
      event: "landing_view",
      anonymousId: "anon-123",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: null,
        anonymous_id: "anon-123",
        event: "landing_view",
      }),
    );
  });
});
