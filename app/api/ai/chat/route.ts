import { executeNativeHermesAssistant } from "@/features/ai/native-assistant/executor";

export const maxDuration = 60;

export async function POST(request: Request) {
  return executeNativeHermesAssistant(request);
}
