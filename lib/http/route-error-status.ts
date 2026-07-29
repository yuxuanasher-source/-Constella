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
  /^Organization is read-only because billing /,
  /^Current plan is not entitled to /,
  /^Complex cost rules are not enabled for this project$/,
];

const conflictErrorPatterns = [/^Duplicate report screenshot content$/];

export function statusForServiceError(error: Error): number {
  if (conflictErrorPatterns.some((pattern) => pattern.test(error.message))) {
    return 409;
  }

  return permissionErrorPatterns.some((pattern) => pattern.test(error.message))
    ? 403
    : 400;
}
