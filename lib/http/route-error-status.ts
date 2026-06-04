const permissionErrorPatterns = [
  /^Current role cannot /,
  /^Only MCN staff can /,
  /^Only owner can /,
  /^Only owner and ops_manager can /,
  /^Only owners can /,
  /^Only streamers can /,
  /^Streamers can only /,
  /^Current streamer is not bound /,
  /^Cross-organization access is not allowed$/,
];

export function statusForServiceError(error: Error): number {
  return permissionErrorPatterns.some((pattern) => pattern.test(error.message))
    ? 403
    : 400;
}
