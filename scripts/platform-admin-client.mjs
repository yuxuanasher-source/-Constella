import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

export function createPlatformAdminClient(
  url,
  serviceRoleKey,
  clientFactory = createClient,
) {
  return clientFactory(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket,
    },
  });
}
