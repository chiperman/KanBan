import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export default async function DataHealthPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/data-health", searchParams);
  if ((await getServices().auth.currentSession()) === null) redirect("/");
  redirect("/settings?view=data#history-coverage");
}
