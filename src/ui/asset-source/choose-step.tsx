import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";

import type { ProviderSelectionId } from "./shared";

export function SourceChooseStep({
  providerOptions,
  chooseProvider,
  leaveFlow,
}: {
  providerOptions: { id: ProviderSelectionId; label: string }[];
  chooseProvider(id: ProviderSelectionId): void;
  leaveFlow(): void;
}) {
  return (
    <section aria-labelledby="source-flow-choose-title" className="asset-source-flow__panel">
      <h2 id="source-flow-choose-title">选择来源类型</h2>
      <div aria-label="来源类型" className="source-provider-list" role="group">
        {providerOptions.map((description) => (
          <VibeButton
            className="source-provider-button"
            key={description.id}
            onClick={() => chooseProvider(description.id)}
            type="button"
            variant="outline"
          >
            <span>{description.label}</span>
            <span aria-hidden="true">→</span>
          </VibeButton>
        ))}
      </div>
      <VibeLink href="/settings?view=plugins" variant="text">
        浏览集成插件
      </VibeLink>
      <VibeButton onClick={leaveFlow} type="button" variant="text">
        取消返回
      </VibeButton>
    </section>
  );
}
