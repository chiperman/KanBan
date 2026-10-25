# 来源接入与读取边界

本文维护当前接入链路和适配器导航。2026-10-20 按本地源码整理，未重新核对外部 API 或访问真实账户；业务口径以 [CONTEXT](../../CONTEXT.md) 和 [有效 ADR](../adr/README.md) 为准，待验收事项统一见 [backlog](../backlog.md#真实运行与人工验收)。

## 接入链路

| 入口 | 职责 |
| --- | --- |
| [Provider 定义](../../src/domain/asset-source-providers.ts) | 来源类型与接入字段 |
| [接入事务](../../src/server/asset-source-onboarding.ts) / [Provider adapters](../../src/server/asset-source-provider-adapters.ts) | 预览、临时加密、确认时重验和保存；公共预览不返回凭证正文或持仓明细 |
| [同步服务](../../src/server/refresh/asset-synchronization.ts) | 读取来源、保存快照与覆盖状态；失败时保留最后成功数据并表达时效 |
| [刷新器路由](../../src/server/asset-sources/router.ts) / [生产装配](../../src/server/production.ts) | 选择对应适配器并注入凭证、行情与存储能力 |

统一刷新入口及周期状态见 [源码导航](../current-baseline.md#其他实现入口)。组合趋势按同日来源累计有效观测，后台调度与刷新互斥见 [后台自动采集](service-composition.md#后台自动采集)；正式日结仍是 [独立流程](service-composition.md#正式日结)。

## 适配器导航

| 来源 | 实现入口 | 读取与解释边界 |
| --- | --- | --- |
| 长桥 | [连接路由](../../src/server/asset-sources/longbridge-connections.ts) | 证券、账户现金与账户总额；CLI/SDK 选择及身份绑定见 [服务生命周期](service-composition.md) |
| Binance | [binance.ts](../../src/server/asset-sources/binance.ts) | 按账户及产品读取；客户端、持仓、成本、市场解析与估值按同目录 `binance-*.ts` 拆分，Stocks 与普通 Spot 的持仓、报价和成本历史分别处理 |
| OKX | [okx.ts](../../src/server/asset-sources/okx.ts) | 平台总额与产品覆盖分别解释；Trading Bot 以 `stgyEq` 按币种汇总，不伪造逐策略明细 |
| Bitget | [bitget.ts](../../src/server/asset-sources/bitget.ts) | 区分 Classic 与 UTA；UTA 现金范围检查会拒绝含合约仓位或挂单的连接 |
| BIT / Matrixport | [bit.ts](../../src/server/asset-sources/bit.ts) | 托管账户的 Wallet、Balance+、DCP 总头寸及活跃订单，使用独立行情估值 |
| Ethereum / BNB 观察钱包 | [ethereum.ts](../../src/server/asset-sources/ethereum.ts) | 公开地址余额、已识别代币与已知协议仓位；只读 RPC，不持有签名能力 |

总额与持仓的权威关系、金额精度及缺失值语义在 CONTEXT 维护。`aggregate-only` 表示明细粒度，不自动代表来源总额不完整；产品明细不能与已包含它的平台总额重复相加。新增产品必须核对当前只读接口、账户范围和去重关系，不能从历史流水反推当前资产。

## 容易误用的来源细节

### 长桥同步状态

行情连接与资产同步分别显示：实时行情连接成功只证明报价可用，完整资产成功保存后才显示“资产已同步”；失败时保留最后成功资产及其时间。CLI 请求保留白名单方法与 RPC 错误码；按[官方 serve 错误规则](https://open.longbridge.com/docs/cli/serve)，上游故障（`-32000`）、超时与进程意外退出沿用同步器的最多三次、总预算 60 秒重试，参数错误不重试，取消不启动备用读取。CLI/SDK 均失败时保留两路安全诊断，不落盘原始异常、请求参数、URL 或凭证。

### 长桥逐日资产

[逐日读取器](../../src/server/asset-sources/longbridge-daily-assets.ts) 通过连接路由读取 `/v1/portfolio/profit-analysis-summary`：CLI 使用 `serve` 的 `api.get`，SDK 使用官方 SDK HttpClient。每个已结束的上海自然日单独请求；只使用美元 `ending_asset_value`。`invest_amount`、平台收益和当前汇率不用于补本金。日期、截止时间、币种、数据更新时间及当前通道与来源绑定的真实账户身份均需匹配。

逐日补取按数据库中的来源配置显式启用，绑定来源身份、真实账户和首日；网页全量刷新与既有后台检查共用该入口和 SQLite 租约。每轮最多七天、总预算 45 秒，单并发、请求间隔一秒，失败等待至少五分钟后重试；逐日成功持久化，重启后从缺失日继续，不影响已取得的实时快照。未启用的实例不请求该接口；开发版启用不改变正式版。

[持久化入口](../../src/server/persistence/sqlite-longbridge-daily-assets.ts) 在事务内替换同日美股估值与来源历史，删除同日旧资产记录，保留本金和其他账本。仅校准已存在组合观测中的长桥分量，缺少其他币种历史依据时标记受限，不创建缺少其他来源的组合日记录。来源详情和来源历史优先采用逐日美元值；新接口原始响应按账户、日期保存于本实例 `data/provider-history/longbridge/`，重试覆盖同日文件，不保留旧估值副本。

### Binance Stocks

`EQ_*` 持仓来自 Funding。成本使用签名的 `GET /sapi/v1/equity/order/history`，只有历史数量严格守恒时才计算当前剩余仓位的加权平均成本，买入费用计入成本；历史不足或无法守恒时保持 `null`。普通 Spot 的 `myTrades` 和当前报价不能替代 Stocks 成本证据。

### BIT / Matrixport

适配器只允许以下四条 GET 路径：

- `/mapi/v1/wallet/balance`
- `/flexible/api/v2/app/homepage`
- `/dcp/api/v1/total-positions`
- `/dcp/api/v1/orders`

Wallet 与 Balance+ 使用独立 `Prices` 估值，不调用交易 RFQ。DCP 的 `total_position` 是其 USD 总头寸；订单只解释明细，本金不再计入总额。订单明细失败时可保留已取得的总头寸，不能把订单读取失败误当作总额丢失。

当前权限摘要只声明应用使用的读取能力，不能证明 API Key 没有额外权限，接入时仍需所有者确认只读范围。账户身份与凭证身份也须区分，不能把 API Key 指纹冒充平台账户 ID。

### Lido 与 Lista 提现申请

两者都由 `ethereum.ts` 内的协议仓位适配器读取，无需专门的协议 API Key，适配原则见 [ADR-0005](../adr/0005-use-protocol-position-adapters-for-known-evm-contracts.md)。

- Lido：读取公开地址的未领取申请及状态；排队中使用申请量，可领取时通过检查点和 `getClaimableEther` 读取精确 ETH。已领取申请不继续计价。
- Lista：每次 BSC 持仓刷新读取 `getUserWithdrawalRequests` 与 `getUserRequestStatus`，即使普通 `slisBNB` 余额为零也检查。申请按 `uuid` 标识，以链上返回的 BNB `amount` 估值；预计日期不代表已经可领取。
- 读取失败时保留明确的 `unknown` / 部分覆盖，不能默认为零或伪称完整；普通代币余额与申请分别读取，避免重复计价。

## 网络排查

启动时的 Node 网络准备由 [local-network-environment.mjs](../../scripts/local-network-environment.mjs) 负责。排查时区分 DNS、代理、公开接口、账户认证与产品覆盖；公开接口可达不能证明真实账户读取成功。不要沿用旧现场的代理节点、IP 或区域设置，也不要以更换凭证代替网络诊断。
