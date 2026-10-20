import { redirect } from "next/navigation";

import {
  redirectLoopbackIpToLocalhost,
  type PageSearchParams,
} from "@/server/auth/canonical-origin";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export default async function AssetSourcesPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  await redirectLoopbackIpToLocalhost("/asset-sources", searchParams);

  const services = getServices();
  if ((await services.auth.currentSession()) === null) redirect("/");
  redirect("/assets?view=sources");
}
