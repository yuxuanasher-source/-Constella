import { describe, expect, it } from "vitest";

import { getPublicRequestOrigin } from "./public-request-origin";

describe("getPublicRequestOrigin", () => {
  it("prefers the reverse-proxy origin over a configured internal port", () => {
    const request = new Request("http://127.0.0.1:3000/api", {
      headers: {
        "x-forwarded-host": "public.example",
        "x-forwarded-proto": "https",
      },
    });

    expect(
      getPublicRequestOrigin(request, {
        NEXT_PUBLIC_APP_URL: "http://public.example:3000",
      }),
    ).toBe("https://public.example");
  });

  it("uses the configured app origin when proxy headers are absent", () => {
    expect(
      getPublicRequestOrigin(new Request("http://127.0.0.1:3000/api"), {
        NEXT_PUBLIC_APP_URL: "https://app.example/base/path",
      }),
    ).toBe("https://app.example");
  });

  it("falls back to the request origin for invalid external origins", () => {
    const request = new Request("http://localhost:3000/api", {
      headers: {
        "x-forwarded-host": "public.example/path",
        "x-forwarded-proto": "https",
      },
    });

    expect(
      getPublicRequestOrigin(request, {
        NEXT_PUBLIC_APP_URL: "javascript:alert(1)",
      }),
    ).toBe("http://localhost:3000");
  });
});
