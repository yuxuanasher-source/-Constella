export const DEFAULT_MAX_JSON_BODY_BYTES = 4 * 1024;

export type BoundedJsonBodyErrorCode =
  | "INVALID_JSON_BODY"
  | "REQUEST_BODY_TOO_LARGE";

export class BoundedJsonBodyError extends Error {
  readonly name = "BoundedJsonBodyError";

  constructor(
    public readonly code: BoundedJsonBodyErrorCode,
    message: string,
    public readonly statusCode: 400 | 413,
  ) {
    super(message);
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw invalidJsonBody();
    }
    if (Number(declaredLength) > maxBytes) {
      throw bodyTooLarge();
    }
  }

  if (!request.body) {
    throw invalidJsonBody();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw bodyTooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedJsonBodyError) {
      throw error;
    }
    throw invalidJsonBody();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidJsonBody();
  }
}

function invalidJsonBody() {
  return new BoundedJsonBodyError(
    "INVALID_JSON_BODY",
    "Request body must be valid JSON",
    400,
  );
}

function bodyTooLarge() {
  return new BoundedJsonBodyError(
    "REQUEST_BODY_TOO_LARGE",
    "Request body is too large",
    413,
  );
}
