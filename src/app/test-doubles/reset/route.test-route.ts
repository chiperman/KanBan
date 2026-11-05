import { resetTestStateResponse } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function POST() {
  return resetTestStateResponse();
}
