import { PluginManagementError } from "./installation";

export function pluginManagementFailure(error: unknown, fallback: string): Response {
  const rejected = error instanceof PluginManagementError;
  return Response.json(
    { error: rejected ? error.message : fallback },
    { status: rejected ? 400 : 500 },
  );
}
