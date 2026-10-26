import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";

import type { Confirmation } from "./requests";

export function PluginConfirmationDialog({
  confirmation,
  pending,
  setConfirmation,
  perform,
}: {
  confirmation: Confirmation;
  pending: boolean;
  setConfirmation(confirmation: Confirmation | null): void;
  perform(confirmation: Confirmation): Promise<void>;
}) {
  return (
    <VibeDialog
      titleId="plugin-confirm-title"
      title={
        confirmation.action === "import"
          ? `安装 ${confirmation.info.label}`
          : `${{ install: "安装", update: "更新", uninstall: "卸载", rollback: "回滚", enable: "启用", disable: "停用" }[confirmation.action]} ${confirmation.label}`
      }
      onClose={() => {
        if (!pending) setConfirmation(null);
      }}
      description={
        confirmation.action === "uninstall"
          ? "移除插件后会停止此接入的读取，账户、凭证与历史仍然保留。"
          : confirmation.action === "rollback"
            ? `将使用已保留的 ${confirmation.version} 版本。账户与历史保留。`
            : "插件会在运行 KanBan 的电脑上执行代码。请确认信任其开发者和发布来源后安装。"
      }
      actions={
        <>
          <VibeButton disabled={pending} variant="text" onClick={() => setConfirmation(null)}>
            取消
          </VibeButton>
          <VibeButton disabled={pending} onClick={() => void perform(confirmation)}>
            {pending ? "正在处理…" : "确认"}
          </VibeButton>
        </>
      }
    >
      {confirmation.action === "import" ? (
        <div>
          <p>
            {confirmation.info.publisher} · v{confirmation.info.version} · {confirmation.info.id}
          </p>
          <p>{confirmation.info.summary}</p>
          <p className="plugin-marketplace__checksum">SHA-256：{confirmation.info.sha256}</p>
        </div>
      ) : null}
      {confirmation.action !== "import" && ["install", "update"].includes(confirmation.action) ? (
        <div>
          <p>v{confirmation.version}</p>
          {confirmation.repository ? (
            <VibeLink
              href={`https://github.com/${confirmation.repository}`}
              target="_blank"
              rel="noreferrer"
              variant="text"
            >
              {confirmation.repository}
            </VibeLink>
          ) : null}
        </div>
      ) : null}
    </VibeDialog>
  );
}
