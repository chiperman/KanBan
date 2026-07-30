import { headers } from "next/headers";
import { redirect } from "next/navigation";

const LOOPBACK_IP_HOSTS = [
  /^127\.0\.0\.1(?<port>:\d+)?$/,
  /^\[::1\](?<port>:\d+)?$/,
];

export type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function redirectLoopbackIpToLocalhost(
  pathname: string,
  searchParams: PageSearchParams,
): Promise<void> {
  const requestHost = (await headers()).get("host");
  const match = LOOPBACK_IP_HOSTS.map((pattern) => requestHost?.match(pattern)).find(
    Boolean,
  );
  if (!match) return;

  const canonicalUrl = new URL(
    `http://localhost${match.groups?.port ?? ""}${pathname}`,
  );
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) canonicalUrl.searchParams.append(key, item);
    } else if (value !== undefined) {
      canonicalUrl.searchParams.set(key, value);
    }
  }

  redirect(canonicalUrl.toString());
}
