# 来源接入与读取边界

本文维护当前接入链路和适配器导航。2026-11-06 按本地源码更新，未重新核对外部 API 或访问真实账户；业务口径以 [CONTEXT](../../CONTEXT.md) 和 [有效 ADR](../adr/README.md) 为准，待验收事项统一见 [backlog](../backlog.md#真实运行与人工验收)。

## 接入链路

| 入口 | 职责 |
| --- | --- |
| [Provider 定义](../../src/domain/asset-source-providers.ts) / [插件描述](../../src/domain/asset-source-plugin-description.ts) | 官方集成的接入字段与动态表单 |
| [接入事务](../../src/server/asset-source-onboarding.ts) / [Provider adapters](../../src/server/asset-source-provider-adapters.ts) | 预览、临时加密、确认时重验和保存；公共预览不返回凭证正文或持仓明细 |
| [同步服务](../../src/server/refresh/asset-synchronization.ts) | 读取来源、保存快照与覆盖状态；失败时保留最后成功数据并表达时效 |
| [插件管理器](../../src/server/asset-source-plugins/manager.ts) / [生产装配](../../src/server/production.ts) | 校验协议与能力、分派授权和读取并验证结果；全部外部来源使用独立进程；核心不实例化供应商适配器 |

统一刷新入口及周期状态见 [源码导航](../current-baseline.md#其他实现入口)。组合趋势按同日来源累计有效观测，后台调度与刷新互斥见 [后台自动采集](service-composition.md#后台自动采集)；正式日结仍是 [独立流程](service-composition.md#正式日结)。

## 来源插件基础

来源身份与实现代码分离。现有来源保留原 `kind`；官方版本只接受随应用构建的官方来源 ID。历史读取与备份恢复继续校验身份格式，但生产运行时不会从数据目录加载未知插件。

来源持久化 `investmentBookId`（美股、A股、虚拟货币或未归属），账本与趋势分类按保存的业务归属解释，插件清单不能改变已有归属。SQLite 22 将旧平台的既有归属写入此字段；手工来源继续由所有者设置的资产类别确定归属，并同步保存。未知来源不会默认归入虚拟货币账本。账本成员的纳入日期仍需按现行合同确认，不能凭插件安装状态缩小必要来源范围。

[协议](../../plugins/sdk/protocol.ts) 定义稳定 ID、插件版本、协议版本、能力和可序列化的读取参数，以及授权结果的基础结构；原服务端路径保留兼容导出。管理器拒绝重复 ID、不兼容协议和不一致的能力声明。当前生产刷新及正式日结的资产读取均经过管理器，主程序继续持有凭证更新、超时取消、租约、业务落库与观测生成；插件只收到隔离副本。返回快照必须通过金额、时间、估值和覆盖校验，不能将缺价补零或重复计入平台权威总额。

缺少官方集成时，在读取凭证前返回“官方集成不可用”，停止外部读取，保留最后快照与历史，将本次同步标为失败；失败不生成完整观测，也不撤销同日已有的有效观测。备份格式 9 保存明确归属并兼容格式 1–8，自动来源恢复后仍需重新授权，不能因恢复备份而运行集成。

全部外部来源及参考价格服务均由官方源码模块提供：Binance、OKX、Bitget、BIT / Matrixport、Ethereum 观察钱包、BNB 观察钱包、长桥与 CoinGecko。构建时将这些模块编译到应用自己的 `dist/plugins/packages/`，核心继续保留所有者认证、加密凭证、授权事务、账本、持久化、调度、手工来源和历史归档。长桥的资产、OAuth、CLI/SDK 选择、行情推送、K 线、指数、日历与官方逐日数据读取均在长桥包中实现；历史落库与财务口径仍由核心负责。

现有来源保留原 kind、账户算法和凭证格式，官方集成随应用构建并继续关联原记录。构建产物缺失时不提供新增入口，已有来源按集成不可用处理。CoinGecko 是参考价格服务，不产生资产来源卡片。旧 `src/server/asset-sources/` 平台导出仅供兼容调用与既有测试，生产不经这些导出加载实现。

### 官方集成与版本生命周期

官方集成随 KanBan 应用一起构建和发布。设置页只读展示平台名称、当前版本、健康状态和源码仓库链接；用户不需要安装、更新、停用、卸载或回滚插件。

应用构建生成 `dist/plugins/packages/`，生产运行时只从这个构建目录加载官方包。正式数据目录只保存数据库、凭证、来源配置和快照，不保存可执行插件代码。生产运行时不读取数据目录中的插件注册表，也不接受从 GitHub、Release 或本地文件导入的插件。

如果官方构建目录缺少某个集成，该来源会显示为官方集成不可用并保留最后成功快照；应用不会从网络自动补下载代码。用户的自定义集成只能在自己的 KanBan Fork 和独立数据目录中运行。

## 进程协议与动态授权

[Host](../../src/server/asset-source-plugins/stdio-host.ts) 通过逐行 JSON-RPC 2.0 通信，先调用 `initialize` 核对完整清单，再调用 `authorization.preview`、`authorization.revalidate`、`assets.read` 或 `extension.call`。[插件入口](../../plugins/sdk/stdio-server.ts) 将供应商错误转为白名单诊断。普通来源与服务每次操作使用独立进程；长桥由 [RPC 客户端](../../src/server/asset-source-plugins/longbridge-client.ts) 复用常驻 worker，以保留原生 OAuth PKCE 内存态并支持并发推送。无任务 11 分钟后回收，闲置 worker 不阻止 CLI 主进程退出。

普通请求与握手受调用方取消及最多 60 秒预算约束，响应缓冲上限 8 MiB；取消或超时终止进程组并清理嵌套 CLI。长桥行情订阅持续至取消；关闭订阅发取消通知，保留其他请求和 OAuth 会话，停用插件则终止 worker。普通请求最多反向调用核心 16 次，长连接不使用此计数。

平台凭证仅经 stdin 传递，不进入启动参数或日志。通常只继承语言、时区与网络代理白名单，不继承应用加密密钥或 Node 预加载选项。长桥另获 `PATH`、`HOME` 与 `LONGBRIDGE_SERVE_BIN` / `LONGBRIDGE_OAUTH_CLIENT_ID` / `LONGBRIDGE_OAUTH_CALLBACK_PORT`，用于本机 CLI 与 Keychain；其他包不继承这些变量。

反向能力限定为 `prices.quote`（USDT/BTC）、资产读取期间的 `credentials.persist`，以及清单声明的 `configuration.read`（`coingecko.apiKey`、`rpc.ethereum`、`rpc.bsc`）。钱包仅声明自身链 RPC 与 CoinGecko key；服务配置仍由核心加密保存。参考价格与节点连通验证分别交由 CoinGecko 和双链包完成，设置保存仍沿用三个配置一起验证的现行合同。长桥另可读取仅长桥来源的连接状态、固定旧身份并记录所用通道，核心校验这些效果；插件没有任意数据库或核心端口调用权。

可用的官方集成通过所有者认证的 `/api/asset-sources/plugins` 提供字段描述；主程序复用现有字段组件，支持必填的文本、密码、多行文本与选项，不接收集成脚本或 HTML。动态预览/确认位于 `/api/asset-sources/plugins/[pluginId]/preview` 和 `/confirm`，仍经过原有临时加密、公共预览投影与确认重验。主程序仅接受只读权限白名单，确认时账户、权限、范围与初始账本归属必须稳定；重新授权保留原来源 ID 与已保存的账本归属。

## 适配器导航

| 来源 | 实现入口 | 读取与解释边界 |
| --- | --- | --- |
| 长桥 | [插件连接路由](../../plugins/longbridge/src/longbridge-connections.ts) | 证券、账户现金与账户总额；CLI/SDK 选择及身份绑定见 [服务生命周期](service-composition.md) |
| Binance | [独立入口](../../plugins/binance/src/main.ts) / [平台实现](../../plugins/binance/src/binance.ts) / [清单](../../plugins/binance/manifest.json) | 按账户及产品读取；客户端、持仓、成本、市场解析与估值按插件内 `binance-*.ts` 拆分，Stocks 与普通 Spot 的持仓、报价和成本历史分别处理 |
| OKX | [独立入口](../../plugins/okx/src/main.ts) / [平台实现](../../plugins/okx/src/okx.ts) | 平台总额与产品覆盖分别解释；Trading Bot 以 `stgyEq` 按币种汇总，不伪造逐策略明细 |
| Bitget | [独立入口](../../plugins/bitget/src/main.ts) / [平台实现](../../plugins/bitget/src/bitget.ts) | 区分 Classic 与 UTA；UTA 现金范围检查会拒绝含合约仓位或挂单的连接 |
| BIT / Matrixport | [独立入口](../../plugins/bit/src/main.ts) / [平台实现](../../plugins/bit/src/bit.ts) | 托管账户的 Wallet、Balance+、DCP 总头寸及活跃订单，使用独立行情估值 |
| Ethereum / BNB 观察钱包 | [Ethereum 入口](../../plugins/evm-watch-ethereum/src/main.ts) / [BNB 入口](../../plugins/evm-watch-bsc/src/main.ts) / [共享实现](../../plugins/evm/src/ethereum.ts) | 公开地址余额、已识别代币与已知协议仓位；只读 RPC，不持有签名能力 |

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

两者都由 `plugins/evm/src/ethereum.ts` 内的协议仓位适配器读取，无需专门的协议 API Key，适配原则见 [ADR-0005](../adr/0005-use-protocol-position-adapters-for-known-evm-contracts.md)。

- Lido：读取公开地址的未领取申请及状态；排队中使用申请量，可领取时通过检查点和 `getClaimableEther` 读取精确 ETH。已领取申请不继续计价。
- Lista：每次 BSC 持仓刷新读取 `getUserWithdrawalRequests` 与 `getUserRequestStatus`，即使普通 `slisBNB` 余额为零也检查。申请按 `uuid` 标识，以链上返回的 BNB `amount` 估值；预计日期不代表已经可领取。
- 读取失败时保留明确的 `unknown` / 部分覆盖，不能默认为零或伪称完整；普通代币余额与申请分别读取，避免重复计价。

## 网络排查

启动时的 Node 网络准备由 [local-network-environment.mjs](../../scripts/local-network-environment.mjs) 负责。排查时区分 DNS、代理、公开接口、账户认证与产品覆盖；公开接口可达不能证明真实账户读取成功。不要沿用旧现场的代理节点、IP 或区域设置，也不要以更换凭证代替网络诊断。
