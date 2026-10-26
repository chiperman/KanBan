# 第三方集成插件开发

插件可以独立开发和分发，无需修改 KanBan 核心或把源码合入主仓库。用户在“设置 → 插件”从目录、GitHub 仓库或本地包安装，安装后沿用现有的只读授权、账户预览与确认流程。核心负责所有者认证、凭证加密、账本、调度与业务落库，插件负责供应商 API 读取和统一快照映射。

目录与插件包分开维护：官方包随本仓库的插件 Release 发布，第三方可使用自己的 GitHub Release。发布后即可分享仓库地址供用户安装；若需在插件目录展示，再向 [plugins/registry.json](../../plugins/registry.json) 提交 PR，审核合入后收录。一个仓库可包含一个或多个插件。目录安装和官方发行流程见 [插件安装与发布](asset-sources.md#独立包安装与生命周期)。

## 创建和验证

在使用项目指定 Node 与 pnpm 的开发环境中执行：

```sh
pnpm plugin create my-provider ./my-provider
```

新目录包含 `manifest.json`、`main.mjs` 和 `provider.mjs`，可移至独立仓库。模板只使用 Node 内置模块，不依赖 KanBan 源码或 `node_modules`。实现 `provider.mjs` 中的两个函数：

- `readSnapshot(credentials, observedAt, signal)`：调用供应商只读 API，返回统一快照。
- `createAuthorization(input, observedAt, signal)`：验证账户身份、凭证权限与支持范围，返回授权结果及首次快照。

模板默认抛出“尚未实现”错误，不返回虚构余额。默认入口把 `credentials` 作为 JSON 字符串保存，读取及重验前解析为对象；更换凭证格式时须同步修改入口。可自行用 TypeScript 或其他技术实现，但交付入口须为可独立运行的 `.mjs`，由 KanBan 使用其 Node 进程启动。外部依赖需自行打包，不能依赖用户检出开发仓库。

先把本地包安装到隔离的数据目录：

```sh
pnpm plugin install ./my-provider --data-dir /绝对路径/隔离数据
pnpm plugin list --data-dir /绝对路径/隔离数据
```

用同一数据目录启动开发实例，在添加来源流程中验证输入、预览、确认重验与后续刷新。安装握手通过仅证明协议与入口可用，业务验收还需核对真实只读权限、稳定账户身份、金额、缺价与覆盖状态。不要用正式数据目录测试未完成的插件。

## 清单和表单

```json
{
  "id": "plugin:my-provider",
  "version": "1.0.0",
  "protocolVersion": 1,
  "entry": "main.mjs",
  "capabilities": ["assets.read", "authorization.preview", "authorization.revalidate"],
  "metadata": {
    "summary": "读取示例平台的现货账户与余额。",
    "publisher": "开发者名称",
    "homepage": "https://github.com/your-name/my-provider",
    "license": "MIT"
  },
  "description": {
    "label": "My Provider",
    "fields": [
      { "id": "apiKey", "label": "只读 API Key", "control": "password", "required": true }
    ],
    "previewScope": "现货账户及余额；不支持合约。"
  }
}
```

第三方 ID 使用 `plugin:<名称>`，最长 128 字符；名称由小写字母、数字及单个点、短横线或下划线分隔的段组成。选择能区分开发者的名称，发布后保持稳定；ID 是来源身份，不能随展示名称或版本改变。内置平台的兼容 ID 保留给官方包。

版本格式为 `主版本.次版本.修订版本`，可带预发布后缀。更改包内容须提高版本；安装器拒绝同版本不同内容和隐式降级。`entry` 必须是包内相对 `.mjs` 路径，不能越出包目录。

账户接入声明三个能力及 `description`；字段最多 16 个，支持 `text`、`password`、`textarea`、`select`，当前均须 `required: true`。字段 ID 为字母开头的英文、数字或下划线，不能重复或使用 `provider` 等保留名称。选项字段还需 `options: [{"value":"spot","label":"现货"}]`，可设置有效的 `defaultValue`。表单只描述数据，不执行插件提供的 HTML 或浏览器脚本。

`metadata` 用于插件卡片；`homepage` 仅接受 HTTPS。清单以 [验证器](../../src/server/asset-source-plugins/manifest.ts) 和 [协议类型](../../plugins/sdk/protocol.ts) 为准。

## 进程协议

stdin/stdout 传输逐行 JSON-RPC 2.0，每条消息以换行结束。stdout 只输出协议，调试信息写 stderr，禁止输出凭证。每次启动先握手：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}
```

响应使用相同 `id`，`result` 必须与包内 `manifest.json` 的完整对象一致，包括 `entry`、描述和元数据。

| 方法 | params | result |
| --- | --- | --- |
| `authorization.preview` | `{ input, observedAt }`，input 为清单表单字段 | 授权结果 |
| `authorization.revalidate` | `{ authorization, observedAt }`，authorization 为上次完整结果 | 重新读取并验证后的授权结果 |
| `assets.read` | `{ source, credentials, mode, attemptedAt }` | `{ snapshot }` |
| `cancel` 通知 | `{ id }`，无请求 id | 取消对应任务，不返回响应 |

例如预览请求：

```json
{"jsonrpc":"2.0","id":2,"method":"authorization.preview","params":{"input":{"apiKey":"user-supplied-key"},"observedAt":"2026-10-23T02:00:00.000Z"}}
```

`source`、`mode` 的完整结构见 [来源模型](../../src/domain/asset-sources.ts) 与 [读取请求](../../plugins/sdk/protocol.ts)。普通操作会分别启动进程，不能依赖进程内缓存跨预览、确认或刷新保存状态；需要保存的授权材料放入加密凭证。

仓库内官方插件共用 `plugins/sdk/` 的协议、stdio 入口与运行时工具，构建器拒绝其运行时依赖 `src/server/`；纯领域模块可随包发射，少量类型仍复用服务端端口。宿主参考价格和配置读取合同集中在 [host-capabilities](../../plugins/sdk/host-capabilities.ts)，不包含全局配置管理或持久化接口，核心服务复用这些合同；配置读取仍受清单声明及宿主校验约束。此目录不是独立发布的 npm SDK；第三方独立开发优先使用上述模板与协议合同。

失败返回 `error: { code: -32000, message: "只读接入失败" }`，不把原始供应商异常、URL 或密钥拼入报文。核心只接受白名单诊断，通用错误显示为读取或授权失败。安装握手预算 5 秒，普通请求最多 60 秒，协议缓冲上限 8 MiB；供应商请求应传递 `signal` 并在预算内结束。超时或取消时核心可以终止进程及其子进程。

## 授权结果

`createAuthorization` 返回以下对象，其中 `snapshot` 为本次真实读取的快照：

```js
return {
  credentials: JSON.stringify(input),
  account: { id: providerAccountId, label: accountLabel },
  permissions: ["account", "positions"],
  investmentBookId: "crypto",
  scopeFingerprint: "spot",
  snapshot
};
```

`account.id` 应来自供应商稳定账户身份，不能使用 API Key 或其指纹冒充账户 ID。预览与确认时重新读取，账户、权限和范围必须一致。`scopeFingerprint` 可表达子账户或产品范围；更换密钥不应改变同一账户身份。

权限只接受 `account`、`positions`、`market-data`、`public-address`，拒绝 `trade`、`transfer`、`withdraw`。插件仍须核对供应商真实权限；声明数组不能证明 API Key 没有额外权限。只请求读取，不发起下单、划转或签名。

`investmentBookId` 必须明确为 `us-stocks`、`a-shares`、`crypto` 或 `null`。它确定新增来源的业务归属，由核心保存；不能在后续刷新或升级插件时重分类既有来源。凭证仅经 stdin 传输，由核心加密保存；插件不接收数据库句柄或应用加密密钥。

## 快照映射

以下只展示“平台已证明总额完整，但只提供总额明细”的格式；金额和时间应替换为供应商证据：

```json
{
  "total": { "amount": "42.125", "currency": "USD" },
  "holdings": [],
  "exchangeRates": [],
  "syncedAt": "2026-10-23T02:00:00.000Z",
  "coverage": {
    "status": "complete",
    "totalIsAuthoritative": true,
    "products": [{ "product": "spot", "capability": "aggregate-only", "freshness": "current", "message": null }],
    "unexplainedValue": null,
    "excludedPositiveAccounts": []
  }
}
```

有持仓明细时，每项包括 `symbol`、`name`、`quantity`、`currency`、`assetClass`、`currentPrice`、`marketValue`、`sourceMarketValue`、`valuation`、`costPrice`、`platformProfit`、`changePercent`。可空的金额须显式为 `null`。资产类别为 `securities`、`crypto` 或 `cash`，估值必须说明 `valued` 的价格来源与时间，或 `unvalued` / `quote-unavailable` 的原因。完整结构见 [资产合同](../../src/server/ports/assets.ts) 和 [快照校验器](../../src/server/asset-source-plugins/snapshot-validation.ts)。

金额、数量和汇率使用十进制字符串，不能用浮点数或科学计数法传输；缺价保持 `null`，不能补零。覆盖未知或部分支持时使用 `unknown` / `partial` 并说明产品范围，读取失败不能伪造空账户。平台权威总额与已包含的持仓明细不能重复相加；`aggregate-only` 说明明细粒度，不自动降低总额完整性。财务口径以 [CONTEXT](../../CONTEXT.md) 为准。

## 打包和分发

```sh
pnpm plugin pack ./my-provider ./my-provider-1.0.0.tar.gz
pnpm plugin install ./my-provider-1.0.0.tar.gz --data-dir /绝对路径/隔离数据
```

`pack` 输出归档的 SHA-256 和字节大小，目标文件必须不存在。包根包含清单与入口，压缩不超过 16 MiB、展开不超过 64 MiB、文件不超过 4000 个；不接受符号链接、特殊文件或越界路径。请用该命令生成受支持的 USTAR 包，不直接压缩含顶层目录、`node_modules`、开发密钥或系统元数据的工作目录。

独立仓库发布时，加上仓库和 tag 参数，生成供 KanBan 读取的 `catalog.json`：

```sh
mkdir -p release-v1.0.0
pnpm plugin pack ./my-provider ./release-v1.0.0/my-provider-1.0.0.tar.gz \
  --repository your-name/my-provider --release v1.0.0
```

把该目录中的 `.tar.gz` 和 `catalog.json` 一起上传到公开仓库 `your-name/my-provider` 的 `v1.0.0` Release。输出目录须先创建，附件和 `catalog.json` 须不存在；命令不会发布到 GitHub。清单包含协议、当前 Node 主版本、完整插件描述、附件大小及 SHA-256，请勿手工修改后复用旧摘要。第三方使用自己的 `plugin:` ID，不能覆盖官方兼容 ID 或 `plugin:coingecko`。

一个仓库有多个插件时，使用批量发行命令，一次传入该仓库全部插件的可运行包目录：

```sh
pnpm plugin release ./provider-a ./provider-b --output ./release-v1.1.0 \
  --repository your-name/plugins --release v1.1.0
```

命令创建新输出目录，生成每个插件的独立 `.tar.gz` 及包含全部插件的 `catalog.json`，自动填入版本、大小、摘要和清单。最多 100 个插件，目录不超过 512 KiB；重复 ID 或附件名会拒绝，打包中途失败会清理本次产物，不覆盖已有目录。请将所有生成文件一起上传到同一个 Release；即使只更新其中一个插件，也必须包含未改动插件的记录与附件，未改动插件保持原版本。需要编译的插件应先完成构建，再传入可运行包目录。

用户在“从 GitHub 安装”填写 `your-name/my-provider` 或完整 Release 地址，先查看插件及来源，再确认安装；同一 Release 有多个插件时先选择。查看只读取发行信息，不执行入口；确认后才下载校验并握手。CLI 也支持：

```sh
pnpm plugin inspect your-name/my-provider
pnpm plugin install your-name/my-provider --data-dir /绝对路径/隔离数据
pnpm plugin install https://github.com/your-name/my-provider/releases/tag/v1.0.0 --data-dir /绝对路径/隔离数据
# 多插件仓库需要指定 ID
pnpm plugin install your-name/plugins --plugin plugin:my-provider --data-dir /绝对路径/隔离数据
```

直接安装不依赖目录收录。未指定 tag 时，从 GitHub 最近 100 个 Release 中选择首个非草稿、非预发布且含 `catalog.json` 的版本；指定地址则读取该 tag。安装确认固定具体 tag、版本、仓库和摘要，信息变化须重新查看。所有安装入口均读取此完整发行目录，不逐个搜索旧 Release；多插件仓库须使用上面的批量发行命令，单插件 `pack` 每次只生成一个条目，不合并已有目录。

发布更新时提高发生改动的插件版本，使用新输出目录生成全量插件包与目录并上传新 Release。目录安装和 GitHub 直接安装都保存来源，后续“检查更新”或 `pnpm plugin update plugin:my-provider` 从原仓库检查，无需每次提交目录 PR；目录下架或改仓库也不会改变已安装插件的更新来源。不会隐式降级，更换仓库需卸载重装。失败升级保留原注册，历史版本可回滚。CLI 的 `install` 是直接执行安装的明确指令，请先用 `inspect` 核对来源。

也可继续直接分发 `.tar.gz`，由用户在“导入插件包”或 CLI 安装；本地导入不保存 GitHub 更新来源，后续需再次导入或从 GitHub 安装以关联来源。发布时注明支持的 KanBan 协议、Node 版本、资产范围与已知限制。

插件是本机执行代码，隔离进程不限制文件和网络权限；哈希也不是发布者身份认证。通用包只依赖 Node 时可跨平台，携带原生模块或二进制时必须标明平台、架构与运行要求。当前协议没有任意第三方 UI 扩展或自动发现所有社区仓库的能力；`extension.call` 用于核心已知服务合同，单独声明它不会给新服务增加应用入口。

## 上架插件目录

1. 在自己的公开 GitHub 仓库发布 Release，将打包好的 `.tar.gz` 和 `catalog.json` 作为附件上传，确保无需登录即可下载。
2. 向本项目提交 PR，在 [plugins/registry.json](../../plugins/registry.json) 的 `plugins` 数组中添加一条记录。只提交目录信息，插件源码和安装包仍放在自己的仓库。
3. 合入默认分支后，用户在插件页点击“检查更新”，即可查看介绍、项目主页并确认安装。

目录只登记稳定 ID、介绍与发布仓库，不固定版本和附件：

```json
{
  "id": "plugin:my-provider",
  "label": "My Provider",
  "summary": "读取示例平台的现货账户与余额。",
  "publisher": "开发者名称",
  "homepage": "https://github.com/your-name/my-provider",
  "assetSource": true,
  "repository": "your-name/my-provider"
}
```

`id` 须与包内清单一致；名称、用途、开发者、主页和 `assetSource` 应与插件元数据及能力相符。版本、附件、大小、摘要、完整清单及运行要求从该仓库的最新稳定插件 Release 获取。当前支持协议 1 和项目指定的 Node 主版本，不支持依赖登录的下载地址或任意 URL。下载地址由仓库、Release tag 和附件名组合生成；安装前会核对大小、摘要、清单与入口握手。

收录只需提交一次目录 PR，后续发新版无需修改目录。旧格式条目的 `package.repository` 仍可读取，但只沿用仓库地址，固定版本与附件不再生效；新条目使用上面的格式。用户均须手动确认升级，确认绑定所见版本、仓库与 SHA-256，发行信息变化须重新查看。已安装记录保存发布仓库，更换仓库需要核对来源后卸载重装。目录记录只提供浏览和安装信息，不会替换既有账户、凭证或业务历史。
