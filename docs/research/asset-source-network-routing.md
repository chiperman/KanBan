# 资产来源刷新失败与网络分流调研

核查日期：2026-09-17，时间均为 Asia/Shanghai。
范围：本机数据库、运行代码、ClashMac 配置与连接记录、无凭证公开接口。前期只读排查；后续经用户确认实施下述 DNS 修复。未修改凭证或资产数据。

## 已实施的最小修复（2026-09-17 约 21:53）

用户确认后，通过 Computer Use 在 ClashMac 的 DNS 引擎页面保存：

```yaml
nameserver-policy:
  openapi.okx.com: https://1.1.1.1/dns-query#RULES
proxy-server-nameserver:
  - https://dns.alidns.com/dns-query
  - https://doh.pub/dns-query
```

该域名使用 Cloudflare DoH，DNS 连接按现有规则路由；节点域名保留原有 AliDNS/DNSPod 解析服务器，避免 DNS 对代理的循环依赖。未修改订阅文件、代理组、节点选择或分流规则；未迁移到此前调研的本地配置方案。

界面保存后，应用偏好已出现 dnsNameserverPolicy 和 dnsProxyServerNameserver，但核心生成配置尚未更新。随后界面菜单控制返回失效元素、截图不可用，使用 ClashMac 官方 CLI 的 reload 热重载，返回 status=ok；重载后的生成配置包含上述两项。

实测结果：

- 核心 DNS 查询返回 Cloudflare 公网地址 104.18.43.174、172.64.144.82，已不再返回 169.254.0.2。
- curl 访问 OKX 公开时间接口返回 HTTP 200、code=0，约 1.62 秒。
- Node fetch 连续两次返回 HTTP 200、code=0，约 963 ms、172 ms。
- 当前远程订阅仍为 GlaDOS - Clash standard.yaml。修复保存在应用偏好中，热重载后已验证保留。

修复当时尚未完成真实账户刷新验证；后续数据库核查已确认恢复，见下节。实际更新订阅后的防覆盖验收仍未完成：ClashMac 的 Computer Use 菜单元素失效阻碍订阅更新操作，不能声称已经实测订阅更新。

## 修复后的账户数据核查（2026-09-17 约 22:01）

只读检查本机 SQLite 中的来源、同步状态、快照与覆盖标记，并使用当前项目的估值函数重新计算完整性，未修改资产数据或网络设置。

- 7 个自动来源均在 21:59:49 成功同步，状态为 current、错误为空；OKX 已有本轮真实账户快照，并非仅公开接口恢复。
- 按现有纳入范围，USD、CNY、HKD 总额均通过完整性校验，未估值数量与过期来源数量均为 0。此结果不代表已逐项对照平台账单。
- 长桥 2 笔期权缺少独立行情，账户总额已包含；部分交易所产品只提供汇总金额，不能据此声称持仓明细全部完整。
- Ethereum 与 BSC 的 15 项未识别代币均逐项匹配现有忽略设置，不计入当前统计。
- A 股与 OKX Pay 为手工记录，最后更新日期分别为 8 月 16 日、8 月 3 日，仍需所有者核对。
- 9 月 15 日趋势记录缺失，9 月 16 日趋势记录标记过期；本次恢复未补齐历史。
- SQLite quick_check 返回 ok，外键检查无异常。

下文按排查阶段保留证据；其中的“当前”“未修改”和“未验证”描述对应各阶段现场，以本节和已实施修复章节为最终状态。

## ClashMac 持久化方案调研（未实施）

调研时本机 ClashMac 27.1.2（216），激活 GlaDOS - Clash standard.yaml，manifest 将其标记为 remote。应用系统偏好中独立保存 dnsNameservers、dnsNameserverPolicy 等字段；修复前 dnsNameserverPolicy 为空。本机界面资源与官方文档均确认支持添加本地配置、挂载代理提供者和域名服务器策略。

推荐采用本地配置维护规则、远程订阅提供节点、应用引擎设置维护 DNS 策略的分工：

1. 在“配置”页面通过“+ → 添加本地配置”导入预先整理的本地 YAML，例如 Personal.yaml。迁移时保留现有日常分流逻辑，不能直接换成空白模板后就声称行为不变。
2. 右键该本地配置卡片，选择“挂载代理提供者…”（官方文档称“挂载代理提供商…”），勾选现有 GlaDOS 远程订阅。代理组必须实际引用动态 provider，不能仅复制当前静态节点清单，否则订阅节点更新后仍可能使用旧节点或失效名称。
3. 在本地配置定义稳定的 KanBan-OKX 策略组，引用上述 provider；将 DOMAIN,openapi.okx.com,KanBan-OKX 放在私有地址/IP 分流之前。不要让自定义规则依赖远端订阅可能改名或删除的 Premium 组。
4. 在“引擎配置 → DNS”配置仅针对 openapi.okx.com 的域名服务器策略，使用前述经过验证方向的加密 DNS；若 DNS 查询引用 KanBan-OKX，则本地组必须先存在，并保留独立的代理节点 DNS 以避免解析回路。DNS 表单语法应使用该界面要求的格式，不能直接把整段 YAML 粘入单字段。
5. 激活本地配置后，日常更新 GlaDOS 订阅/provider 的节点资源，保持本地配置为活动配置。不修改生成的 work/config.json，不将自定义修复写进会重新下载的远程 YAML。

这一设计将订阅节点更新与本地规则分开；其取舍是原订阅供应商后续发布的整套分流规则不会自动替换本地规则，需自行维护或明确引用独立规则集。节点被下架、改名或网络不可用仍可能影响连通性，不能将“不覆盖规则”等同于“永远可连接”。

要完成本机防覆盖验收，应先记录本地规则/DNS 策略及运行结果，再实际更新一次订阅、重载或重启，确认活动配置不变、provider 节点可更新、自定义规则及 DNS 策略仍存在、OKX 公开接口与账户刷新成功。本次仅调研，未执行这些会改变配置或运行状态的动作，不能声称已完成防覆盖实测。

官方依据（2026-09-17 在线核对）：

- https://clashmac.app/guide/quick_start — 添加本地配置与激活步骤。
- https://clashmac.app/guide/dashboard/profiles — 本地/远程配置分区、订阅挂载、外部资源更新。
- https://clashmac.app/guide/dashboard/rules — 规则优先级与新增规则置顶。
- https://clashmac.app/guide/dashboard/engine_config — 引擎参数持久化于应用系统偏好，支持特定域名 DNS 和代理节点 DNS。

这些文档支持上述配置架构，但没有提供对本机迁移及订阅更新回归的实际验收结果。

## 最新结论：关闭 Tailscale DNS 后仍失败的原因

用户自行取消 Use Tailscale DNS settings 后，scutil 已不再包含 Tailscale 解析器，Node 查询 OKX 得到 Clash fake-ip 198.18.0.4。但公开接口仍稳定复现 ECONNRESET / curl SSL_ERROR_SYSCALL。此前仅关闭 Tailscale DNS 即可能恢复的建议不完整。

约 21:21，通过现有本机控制接口的只读 GET 查询及日志订阅，确认运行中核心处于 rule 模式，Default Proxy 当前选择 TW Fixed IP → TW-IPv6-P2-1。未修改模式、日志级别或节点选择；控制接口认证只在内存使用，未输出。

核心 DNS 查询直接返回 openapi.okx.com → awscn.okpool.top → 169.254.0.2。其配置的 AliDNS 和 DNSPod HTTPS 查询均独立返回相同结果。对一次普通公开接口请求，核心运行日志明确记录：

```text
[DNS] openapi.okx.com --> 169.254.0.2
[TUN] Auto detect interface for 169.254.0.2 --> en0
[TCP] dial DIRECT (match GeoIP/private) ... --> openapi.okx.com:443 error: dial tcp 169.254.0.2:443: i/o timeout
```

因此该次失败的完整链路是：应用 → Clash fake-ip → 核心解析取得不可用地址 → GEOIP,PRIVATE,DIRECT → en0 直连超时 → 应用端连接重置。该请求没有经过代理节点，不能据此归咎于节点区域或 OKX 账户鉴权。

本轮 curl --resolve 指定两个先前可用公网地址也均失败；当前核心开启 parse-pure-ip、TLS 嗅探和 override-destination，因此这种请求不能作为完全绕过核心域名处理的对照，也不能声称项目只替换 DNS 就一定有效。尚未为指定 IP 请求单独确认核心内部路径。

后续修复应同时保证 OKX 的真实解析结果可用、域名规则在 GeoIP 私有地址直连规则前命中预期路径；仅修改普通兜底节点选择无法修复已命中的 DIRECT。按用户约束，本轮只定位并记录，未修改任何 Clash/ClashMac/系统网络设置，未执行账户刷新。

## 已确认的原因

| 来源 | 本机证据 | 结论 |
| --- | --- | --- |
| Binance | 19:58 保存 HTTP 451 restricted location；同一时刻 Clash 为 Default Proxy → US-Dedicated-P1-3。20:08、20:10 公开时间接口 HTTP 200，对应 Default Proxy → TW Fixed IP → TW-IPv6-P2-1 | 出口区域影响可用性，业务流量跟随通用代理组 |
| OKX | 20:00 保存 fetch failed；Node 公开时间接口重复约 10.5 秒后 UND_ERR_CONNECT_TIMEOUT | 当前 DNS/路由异常，尚非鉴权错误证据 |
| 长桥、Bitget、Ethereum、BSC、BIT/Matrixport | 19:58 最近批次各自成功 | 并非所有来源同时不可用 |

Binance 最近成功为 13:57；OKX 最近成功为 2026-09-16 03:23。状态表只保存最近错误，无法据此统计长期失败率。节点名称用于关联现场，不构成平台对特定地区账户的可用性承诺。

### OKX 对照实验

1. Node dns.lookup 对 openapi.okx.com 和 www.okx.com 均返回 169.254.0.2。
2. route -n get 169.254.0.2 指向 en0，带 REJECT 标记；普通 Node 请求连接超时，curl 连接失败。
3. Google DoH 对同一域名返回 Cloudflare 公网地址 172.64.144.82、104.18.43.174。
4. curl --resolve 分别替换解析结果，保留原 HTTPS 域名、SNI 和证书校验，两次均返回 HTTP 200、业务 code=0，约 0.68/0.70 秒。

当前公开接口失败可由不可用的解析结果及后续路由解释。不要长期写死 CDN IP。后续对照已确认解析结果随查询客户端子网变化，见下文；尚不能确认上游具体策略制定方或意图。

### 订阅更新后的 DNS 根因核查

同一个 Google DoH 接口，仅改变 EDNS Client Subnet，重复得到以下结果：

| 查询条件 | openapi.okx.com 的解析链 |
| --- | --- |
| 0.0.0.0/0，不提供具体客户端网段 | openapi.okx.com.cdn.cloudflare.net → 104.18.43.174 / 172.64.144.82 |
| 223.5.5.0/24，中国地址网段 | awscn.okpool.top → 169.254.0.2 |

AliDNS 的 HTTPS 查询也返回第二条解析链；直接向 Google 查询 awscn.okpool.top 同样得到 169.254.0.2。因此该地址并非只由本机 Clash 生成。此对照支持区域相关的 DNS 应答差异，但不能单凭它认定恶意污染、平台内部政策或实际出口区域。

本机 scutil 显示 Tailscale DNS 100.100.100.100 优先于普通 DNS；该地址路由走 utun6，且处于 Clash TUN 排除的 100.64.0.0/10 中。直接查询该 DNS、系统缓存查询和 Node 解析均得到 awscn.okpool.top → 169.254.0.2。该目标地址路由走 en0 并带 REJECT，解释了应用连接失败。Tailscale 的具体上游未确认，不能直接断言它使用 AliDNS。

对其他公共 DNS 的 UDP/53 查询被 Clash 接管，返回 198.18.0.4；这属于正常 fake-ip，不能冒充那些外部 DNS 的真实回答，也不能与本次不可用的 169.254.0.2 混为一谈。

更新普通分流规则不会改变上述 DNS 路径。新查询仍可能得到同一不可用地址，因此并非只清缓存或补一条 OKX 分流规则就能解决。更新订阅后生成配置中已不见此前的 OKX Premium 显式规则；这不足以证明用户自定义规则被覆盖，也不是本次 DNS 故障成立的必要条件。

本轮遵守用户约束：未修改 Clash、ClashMac、代理、DNS、路由或 Tailscale，也未清缓存。以下网络配置建议仅保留为早期方案参考，不是已执行或待自动执行的动作。若保持这些配置不变，后续可评估项目独立的解析/连接入口，需另行验证兼容性；本轮未实施。

## 网络配置现状

- 项目 .env.local 指定 HTTPS_PROXY 为本机 7890，并启用 NODE_USE_ENV_PROXY。该端口没有监听。
- scripts/local-network-environment.mjs 会在启动时清空不可达的本机代理变量，关闭 Node 环境代理。实跑该函数返回 unavailable=127.0.0.1:7890、NODE_USE_ENV_PROXY=0。
- ClashMac 实际启用 TUN，运行配置没有 HTTP/mixed 监听端口；系统 HTTP/HTTPS/SOCKS 代理也未开启。
- 初次检查长桥与 OKX 有 Premium 规则；订阅更新后 OKX 显式规则已不见。Binance、Bitget、Matrixport、CoinGecko 使用兜底 Default Proxy。多个来源会跟随通用组，但并非全部始终共用一个节点。
- 系统 DNS 有 Tailscale 的 100.100.100.100 和普通 DNS 223.6.6.6；Clash 配置 fake-ip 与 53 端口接管，现场 Node 仍取得异常地址。不能仅凭配置声明认为接管正确。

## 推荐分流方案

优先复用 ClashMac/Mihomo，给资产服务独立策略组，不跟随日常浏览、AI 或全球测速组。规则置于现有 Premium/兜底规则之前，通过客户端支持的持久化覆写保存，不直接修改生成的 work/config.json。

| 域名/服务 | 建议策略 |
| --- | --- |
| api.binance.com | Binance 专用稳定出口；根据账户服务资格和平台允许范围选择，不能以一次 HTTP 200 判断适用性 |
| 当前账户对应的 OKX API 域名 | OKX 专用组，同时修复 DNS；账户区域与网络出口分别配置 |
| 长桥 API/OAuth/行情 | 保留现有可用路径；独立组需覆盖 SDK 实际使用域名 |
| api.bitget.com、mapi.matrixport.com | 可先共用已验证的稳定资产组，出现区域差异再拆分 |
| api.coingecko.com、实际 Ethereum/BSC RPC 域名 | 行情/RPC 组；规则只写域名，不写带 Key 的 URL |

Mihomo 规则示意：DOMAIN,api.binance.com,KanBan-Binance；DOMAIN,openapi.okx.com,KanBan-OKX。对应组须先定义，不能只添加不存在的策略组名。

项目接入建议：开启真实可达、仅监听回环地址的 HTTP/mixed 端口，让 Node 通过 HTTP CONNECT 将主机名交给本机代理解析与分流，减少系统 DNS 依赖。长桥 Rust SDK 的 HTTP/WebSocket 须分别验收，不能认为 Node 的开关覆盖原生 SDK。

另一条路线是继续纯 TUN，先修复 Tailscale/系统 DNS/TUN 的实际接管，并清理旧环境代理配置。不要同时维护两套含义不清的网络入口。

当前代码已有 OKX global/us/eea 域名映射；不能为网络可达随意改变账户注册区域。本次未解密账户凭证核实 region，也未更改它。

## 项目内最小加固

1. 保存脱敏结构化错误：provider、hostname、阶段、cause.code、HTTP 状态、耗时。当前 asset-synchronization.ts 仅保存 error.message，连接超时被压缩成 fetch failed。不记录 API Key、签名、查询参数或完整 RPC URL。
2. 对短暂超时/连接中断、429 和可重试 5xx 有限重试，遵守 Retry-After、总体 60 秒预算和取消信号；签名请求每次重新生成时间戳和签名。451、权限错误、无效凭证不自动重试或自动跨区探测。
3. 保持每小时全量刷新合同，在同一批次内有限重试。当前失败后等待下一小时，网络恢复也不会立即更新状态。
4. 显式要求代理的服务在代理不可达时应给出清楚状态，避免自动回退后用户误以为仍走指定出口。
5. 保留单来源失败时的最后成功资产、其他来源独立提交、部分成功不伪造完整组合历史的现有语义。

以后部署多机/Docker 或需要应用自行管理出口时，可在已有 Adapter 注入点增加按 provider 选择的 fetch/dispatcher；当前优先用代理域名规则，不重复建设地区选择器。

## 验收与限制

网络修改后先测公开健康/时间接口，在 Clash 连接记录确认命中专用组，再真实刷新只读账户，确认状态和 lastSuccessfulAt 更新。验证重启、通用代理组切换不影响业务路径。公开接口成功不证明 API Key、IP 白名单和完整产品接口可用。

已完成原因定位、最小 DNS 修复及修复后真实账户快照核查；尚未完成实际更新订阅后的防覆盖验收。无需前端重建或 Xcode 测试。

## 外部资料

直接 HTTPS 读取以下官方文档，核对 Node 环境代理、Mihomo DNS 和规则能力：

- https://nodejs.org/api/cli.html
- https://wiki.metacubex.one/en/config/dns/
- https://wiki.metacubex.one/en/config/rules/

在线检索工具没有返回可用内容；OKX 官方文档直接抓取亦失败。因此未声称完成 OKX 当前地区政策核对，域名映射描述来自当前仓库代码。
