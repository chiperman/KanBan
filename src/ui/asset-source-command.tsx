"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type AssetSourceCommand,
  type AssetSourceCommandResult,
  requestAssetSourceCommand,
} from "@/ui/asset-source-requests";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type CommandFailure = Exclude<AssetSourceCommandResult, { outcome: "confirmed" }> & {
  sourceId: string;
  command: AssetSourceCommand;
};

export function useAssetSourceCommand() {
  const router = useRouter();
  const requestRef = useRef<AbortController | null>(null);
  const failureRef = useRef<CommandFailure | null>(null);
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  const [pendingRequest, setPendingRequest] = useState<{
    sourceId: string;
    command: AssetSourceCommand;
  } | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const pending = pendingRequest !== null;
  const busy = pending || refreshing;
  const needsCheck = failure?.outcome === "unconfirmed";

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  function updateFailure(value: CommandFailure | null) {
    failureRef.current = value;
    setFailure(value);
  }

  function clearFailure() {
    if (requestRef.current || busy || failureRef.current?.outcome === "unconfirmed") return false;
    updateFailure(null);
    return true;
  }

  function continueAfterCheck() {
    if (!requestRef.current && !busy) updateFailure(null);
  }

  async function run(
    sourceId: string,
    command: AssetSourceCommand,
    onConfirmed: () => void,
  ) {
    if (!clearFailure()) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPendingRequest({ sourceId, command });
    try {
      const result = await requestAssetSourceCommand(sourceId, command, controller.signal);
      // 离开页面后的旧请求不能触发新页面刷新或清除新草稿。
      if (requestRef.current !== controller) return;
      if (result.outcome === "confirmed") {
        onConfirmed();
        startRefresh(() => {
          if (command.action === "delete-source-data") {
            router.push("/settings?view=data#asset-sources");
          }
          router.refresh();
        });
      } else {
        updateFailure({ ...result, sourceId, command });
      }
    } finally {
      if (requestRef.current === controller) {
        controller.abort();
        requestRef.current = null;
        setPendingRequest(null);
      }
    }
  }

  return {
    pending,
    pendingRequest,
    refreshing,
    busy,
    blocked: busy || needsCheck,
    needsCheck,
    failure,
    run,
    clearFailure,
    continueAfterCheck,
  };
}

function commandCheck(sourceId: string, command: AssetSourceCommand) {
  const sourceHref = `/asset-sources/${encodeURIComponent(sourceId)}`;
  switch (command.action) {
    case "delete-source-data":
      return { href: "/settings?view=data#asset-sources", label: "核对来源列表", continueLabel: "确认未删除" };
    case "delete-manual-record": {
      const query = new URLSearchParams({
        interval: "custom", from: command.day, to: command.day, checkDay: command.day,
      });
      return { href: `${sourceHref}?${query}`, label: "核对最新记录", continueLabel: "确认未删除" };
    }
    case "disconnect":
    case "restore":
      return {
        href: `${sourceHref}?view=manage`,
        label: "核对来源状态",
        continueLabel: command.action === "disconnect" ? "确认未断开" : "确认未恢复",
      };
    default:
      return {
        href: command.action === "evm-token-preference" ? `${sourceHref}/settings` : `${sourceHref}?view=manage`,
        label: "核对当前设置",
        continueLabel: "确认未保存",
      };
  }
}

export function AssetSourceCommandFeedback({
  failure,
  focusRecoveryOnMount = false,
  onContinue,
}: {
  failure: CommandFailure | null;
  focusRecoveryOnMount?: boolean;
  onContinue: () => void;
}) {
  const feedbackRef = useRef<HTMLDivElement>(null);
  const outcome = failure?.outcome;

  useEffect(() => {
    if (!focusRecoveryOnMount || outcome !== "unconfirmed") return;
    // 待核对时原操作已禁用，关闭弹窗后把焦点交给可用的恢复入口。
    const frame = window.requestAnimationFrame(() => {
      feedbackRef.current?.querySelector("a")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRecoveryOnMount, outcome]);

  if (!failure) return null;
  const check = commandCheck(failure.sourceId, failure.command);
  return (
    <div className="asset-source-command-feedback" ref={feedbackRef}>
      <VibeNotice role="alert" tone={failure.outcome === "unconfirmed" ? "warning" : "error"}>
        {failure.message}
      </VibeNotice>
      {failure.outcome === "unconfirmed" ? (
        <div className="asset-source-command-check">
          <VibeLink
            aria-label={`${check.label}（新标签页）`}
            href={check.href}
            target="_blank"
            rel="noreferrer"
            variant="outline"
          >
            {check.label}
          </VibeLink>
          <VibeButton
            aria-label={`已${check.continueLabel}，继续操作`}
            onClick={onContinue}
            type="button"
            variant="text"
          >
            {check.continueLabel}
          </VibeButton>
        </div>
      ) : null}
    </div>
  );
}
