type AdmissionShareBrandUiEnv = Record<string, string | undefined>;

const ENABLED_VALUES = new Set(["true", "1", "yes", "on"]);

export function isAdmissionShareBrandUiEnabled(
  env: AdmissionShareBrandUiEnv = process.env,
): boolean {
  const value = env.ADMISSION_SHARE_BRAND_UI?.trim().toLowerCase();
  return value ? ENABLED_VALUES.has(value) : false;
}
