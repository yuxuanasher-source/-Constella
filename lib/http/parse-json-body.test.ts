import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJsonBody, ValidationError } from "./parse-json-body";

const uploadSchema = z.object({
  category: z.enum(["recordings", "report-screenshots"]),
  ownerId: z.string().min(1),
  fileName: z.string().min(1),
});

describe("parseJsonBody", () => {
  it("returns typed data when the JSON body matches the schema", async () => {
    const body = await parseJsonBody(
      jsonRequest({
        category: "recordings",
        ownerId: "application-1",
        fileName: "demo.mp4",
      }),
      uploadSchema,
    );

    expect(body).toEqual({
      category: "recordings",
      ownerId: "application-1",
      fileName: "demo.mp4",
    });
  });

  it("throws a stable validation error without echoing invalid fields", async () => {
    await expect(
      parseJsonBody(
        jsonRequest({
          category: "reports/../../recordings",
          ownerId: "",
          fileName: "demo.mp4",
        }),
        uploadSchema,
      ),
    ).rejects.toMatchObject({
      name: "ValidationError",
      message: "Invalid request body",
    });
  });

  it("throws a stable validation error for malformed JSON", async () => {
    await expect(
      parseJsonBody(
        new Request("http://localhost/api/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{not json",
        }),
        uploadSchema,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
