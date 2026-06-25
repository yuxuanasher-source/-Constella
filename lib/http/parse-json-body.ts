import type { z } from "zod";

export class ValidationError extends Error {
  constructor(message = "Invalid request body") {
    super(message);
    this.name = "ValidationError";
  }
}

export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ValidationError("Invalid JSON request body");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ValidationError("Invalid request body");
  }

  return result.data;
}
