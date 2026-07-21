import { handleHermesReadRoute } from "../../route-handler";

export async function POST(request: Request) {
  return handleHermesReadRoute(request, "xingyao_get_project_summary");
}
