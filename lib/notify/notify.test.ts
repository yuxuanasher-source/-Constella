import { describe, expect, it, vi } from "vitest";

import { sendNotification } from "./notify";

function createInsertClient() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    client: {
      from: vi.fn(() => ({ insert })),
    },
    insert,
  };
}

describe("sendNotification", () => {
  it("creates unread in-app notifications", async () => {
    const { client, insert } = createInsertClient();

    await sendNotification(client, {
      organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      recipientUserId: "11111111-1111-1111-1111-111111111111",
      type: "system",
      title: "Test",
      content: "Hello",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_type: "system",
        status: "unread",
        title: "Test",
      }),
    );
  });
});
