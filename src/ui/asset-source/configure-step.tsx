import type { LongbridgeConnectionMode } from "@/server/asset-sources/longbridge-connection";
import { LongbridgeConnectionSettings } from "@/ui/longbridge-connection-settings";

import {
  type AssetSourceFieldId,
  type AssetSourceProviderDescription,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import type { ExternalServiceConfigurationStatus } from "@/server/ports";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeField, VibeSelectField, VibeTextAreaField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

import {
  EVM_CHAINS,
  type EvmChain,
  type ProviderSelectionId,
  type Reauthorization,
  type SelectedProvider,
  type SourceFields,
} from "./shared";

import type { Dispatch, RefObject, SetStateAction } from "react";

export function SourceConfigureStep({
  configureTitle,
  configurationTitle,
  providerId,
  isEvm,
  pending,
  reauthorization,
  longbridgeMode,
  setLongbridgeMode,
  setLongbridgeReady,
  startOAuth,
  manualLabel,
  setManualLabel,
  evmServiceStatus,
  selectedProvider,
  updateField,
  fields,
  isReauthorizing,
  providers,
  descriptionFor,
  evmChains,
  setEvmChains,
  backToChoice,
  leaveFlow,
  ready,
  start,
  startLabel,
}: {
  configureTitle: RefObject<HTMLHeadingElement | null>;
  configurationTitle: string;
  providerId: ProviderSelectionId | "";
  isEvm: boolean;
  pending: boolean;
  reauthorization?: Reauthorization;
  longbridgeMode: LongbridgeConnectionMode;
  setLongbridgeMode(mode: LongbridgeConnectionMode): void;
  setLongbridgeReady(ready: boolean): void;
  startOAuth(): Promise<void>;
  manualLabel: string;
  setManualLabel(label: string): void;
  evmServiceStatus: ExternalServiceConfigurationStatus | null;
  selectedProvider: SelectedProvider;
  updateField(id: AssetSourceFieldId, value: string): void;
  fields: SourceFields;
  isReauthorizing: boolean;
  providers: AssetSourceProviderDescription[];
  descriptionFor(id: AssetSourceProviderId): AssetSourceProviderDescription;
  evmChains: EvmChain[];
  setEvmChains: Dispatch<SetStateAction<EvmChain[]>>;
  backToChoice(): void;
  leaveFlow(): void;
  ready: boolean;
  start(): Promise<void>;
  startLabel: string;
}) {
  return (
    <section aria-labelledby="source-flow-configure-title" className="asset-source-flow__panel">
      <h2 id="source-flow-configure-title" ref={configureTitle} tabIndex={-1}>
        {configurationTitle}
      </h2>
      {providerId !== "manual" ? (
        <p>
          {providerId === "longbridge"
            ? "仅连接只读账户权限。"
            : isEvm
              ? "仅使用公开地址，无需私钥。"
              : "仅使用具有读取权限的授权。"}
        </p>
      ) : null}
      {providerId === "longbridge" ? (
        <LongbridgeConnectionSettings
          sourceId={reauthorization?.sourceId}
          mode={longbridgeMode}
          onMode={setLongbridgeMode}
          onReady={setLongbridgeReady}
          onAuthorizeSdk={() => void startOAuth()}
          pending={pending}
        />
      ) : providerId === "manual" ? (
        <VibeField
          autoComplete="off"
          autoFocus
          disabled={pending}
          fieldId="manual-asset-label"
          label="资产名称"
          maxLength={40}
          onChange={(event) => setManualLabel(event.currentTarget.value)}
          placeholder="例如：A股"
          value={manualLabel}
        />
      ) : (
        <div className="source-credential-fields">
          {isEvm &&
          evmServiceStatus !== null &&
          (!evmServiceStatus.coinGecko.configured ||
            !evmServiceStatus.ethereumRpc.configured ||
            !evmServiceStatus.bscRpc.configured) ? (
            <VibeNotice role="status" tone="info">
              EVM 钱包依赖全局 CoinGecko、Ethereum RPC 与 BSC RPC 配置。
              <VibeLink href="/settings?view=data#external-services" variant="text">
                配置行情与链上服务
              </VibeLink>
            </VibeNotice>
          ) : null}
          {selectedProvider.fields.map((field) =>
            field.control === "select" ? (
              <VibeSelectField
                disabled={pending}
                fieldId={`asset-source-${field.id}`}
                key={field.id}
                label={field.label}
                onValueChange={(value) => updateField(field.id, value)}
                options={field.options ?? []}
                value={fields[field.id] ?? ""}
              />
            ) : field.control === "textarea" ? (
              <VibeTextAreaField
                autoComplete="off"
                disabled={pending}
                fieldId={`asset-source-${field.id}`}
                key={field.id}
                label={field.label}
                onChange={(event) => updateField(field.id, event.target.value)}
                rows={4}
                value={fields[field.id] ?? ""}
              />
            ) : (
              <VibeField
                autoComplete={field.control === "password" ? "new-password" : "off"}
                disabled={pending}
                fieldId={`asset-source-${field.id}`}
                key={field.id}
                label={field.label}
                onChange={(event) => updateField(field.id, event.target.value)}
                type={field.control}
                value={fields[field.id] ?? ""}
              />
            ),
          )}
          {providerId === "evm" && !isReauthorizing ? (
            <fieldset className="source-evm-chains" disabled={pending}>
              <legend className="vibe-field__label">同步链</legend>
              {EVM_CHAINS.filter((chain) => providers.some((p) => p.id === chain)).map((chain) => {
                const description = descriptionFor(chain);
                return (
                  <label className="vibe-choice" key={chain}>
                    <input
                      type="checkbox"
                      checked={evmChains.includes(chain)}
                      onChange={(event) =>
                        setEvmChains((current) =>
                          event.target.checked
                            ? [...current, chain]
                            : current.filter((value) => value !== chain),
                        )
                      }
                    />
                    <span>{description.label}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {selectedProvider.fieldHelp ? (
            <p className="source-field-help">{selectedProvider.fieldHelp}</p>
          ) : null}
        </div>
      )}
      <div className="asset-source-flow__actions">
        {!isReauthorizing ? (
          <VibeButton disabled={pending} onClick={backToChoice} type="button" variant="text">
            上一步
          </VibeButton>
        ) : (
          <VibeButton disabled={pending} onClick={leaveFlow} type="button" variant="text">
            取消返回
          </VibeButton>
        )}
        <VibeButton
          aria-busy={pending}
          disabled={pending || !ready}
          onClick={() => void start()}
          type="button"
          variant="primary"
        >
          {startLabel}
        </VibeButton>
      </div>
    </section>
  );
}
