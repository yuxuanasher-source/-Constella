import { createRequire } from "node:module";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { tsImport } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const { loadEnvConfig } = nextRequire("@next/env");

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0]?.trim()) {
  console.error("Usage: pnpm platform-admin:grant <email>");
  process.exitCode = 1;
} else {
  const url =
    process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exitCode = 1;
  } else {
    try {
      const { grantPlatformAdmin } = await tsImport(
        "../features/platform-admin/grant-platform-admin.ts",
        import.meta.url,
      );
      const client = createClient(url, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      const granted = await grantPlatformAdmin({
        client,
        email: args[0],
      });
      console.log(`Granted ${granted.email} (${granted.userId})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Grant failed.");
      process.exitCode = 1;
    }
  }
}
