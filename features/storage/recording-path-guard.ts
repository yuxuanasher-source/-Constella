export function normalizeRecordingStoragePath(
  value: unknown,
  organizationId: string,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const path = value.trim();
  const expectedPrefix = `${organizationId}/recordings/`;
  if (
    !path.startsWith(expectedPrefix) ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    throw new Error("Invalid recording storage path");
  }

  return path;
}
