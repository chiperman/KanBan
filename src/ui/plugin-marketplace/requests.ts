import type { PluginManagementAction } from "@/domain/plugin-management";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

export type ImportInfo = {
  id: string;
  label: string;
  version: string;
  publisher: string;
  summary: string;
  sha256: string;
};
export type Confirmation =
  | {
      action: PluginManagementAction;
      id: string;
      label: string;
      version?: string;
      repository?: string;
      sha256?: string;
    }
  | { action: "import"; file: File; info: ImportInfo };
export async function result<T>(response: Response): Promise<T> {
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  const body = await readJsonResult<T & { error?: string }>(response);
  if (!response.ok || !body || body.error) throw new Error(body?.error ?? "插件操作失败，请重试");
  return body;
}
