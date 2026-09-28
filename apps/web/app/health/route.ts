import { webHealthResponse } from "../../lib/health-response";

export const dynamic = "force-dynamic";
export async function GET() {
  return webHealthResponse();
}
