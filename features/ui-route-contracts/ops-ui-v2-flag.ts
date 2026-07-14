type OpsUiV2Env = Record<string, string | undefined>;

const ENABLED_VALUES = new Set(["true", "1", "yes", "on"]);

export function isOpsUiV2Enabled(env: OpsUiV2Env = process.env): boolean {
  const value = env.NEXT_PUBLIC_OPS_UI_V2?.trim().toLowerCase();
  return value ? ENABLED_VALUES.has(value) : false;
}
