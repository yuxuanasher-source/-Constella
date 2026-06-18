export async function register() {
  const { getPublicEnv, getServerEnv } = await import("@/lib/config/env");

  getPublicEnv();
  getServerEnv();
}
