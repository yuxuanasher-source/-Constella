import { beforeEach, describe, expect, it, vi } from "vitest";

const executeNativeHermesAssistantMock = vi.fn();

vi.mock("@/features/ai/native-assistant/executor", () => ({
  executeNativeHermesAssistant: executeNativeHermesAssistantMock,
}));

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    executeNativeHermesAssistantMock.mockReset();
  });

  it("delegates the public endpoint to the native Hermes assistant", async () => {
    executeNativeHermesAssistantMock.mockResolvedValueOnce(
      Response.json({ providerName: "hermes", status: "succeeded" }),
    );
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "分析当前经营情况" }],
      }),
    });

    const response = await POST(request);

    expect(executeNativeHermesAssistantMock).toHaveBeenCalledWith(request);
    await expect(response.json()).resolves.toMatchObject({
      providerName: "hermes",
      status: "succeeded",
    });
  });
});
