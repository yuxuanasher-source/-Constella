export function normalizeRecordingStoragePath(
  value: unknown,
  organizationId: string,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const path = value.trim();
  const expectedPrefix = `${organizationId}/recordings/`;
  if (!path.startsWith(expectedPrefix)) {
    throw new Error("Invalid recording storage path");
  }

  const suffix = path.slice(expectedPrefix.length);
  assertSafeRecordingPath(suffix);
  for (const decoded of decodedRepresentations(suffix)) {
    assertSafeRecordingPath(decoded);
  }

  return path;
}

function assertSafeRecordingPath(path: string) {
  if (path.includes("\\")) {
    throw new Error("Invalid recording storage path");
  }

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid recording storage path");
  }
}

function decodedRepresentations(path: string): string[] {
  const representations: string[] = [];
  let current = path;

  for (let index = 0; index < 8; index += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return representations;
    }

    if (decoded === current) {
      return representations;
    }

    if (
      decoded.includes("\\") ||
      decoded.split("/").length !== current.split("/").length
    ) {
      throw new Error("Invalid recording storage path");
    }

    representations.push(decoded);
    current = decoded;
  }

  throw new Error("Invalid recording storage path");
}
