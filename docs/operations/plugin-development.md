# 集成开发说明

KanBan 的官方发行版只运行随应用构建的官方集成，不提供第三方插件商城、GitHub 安装、本地包导入或在线开发功能。本页说明如何在仓库中新增一个集成目录、如何验证，以及它和核心应用之间的边界。

自定义集成必须在自己的代码分支或独立应用中运行，并使用独立数据目录、测试账户和测试凭证。不要把未审查的自定义代码复制到官方运行副本，也不要让它读取正式数据目录。官方不会审核、签名、分发或支持第三方集成。

如果希望将一个新平台加入官方版本，应提交源码 PR。维护者会审查只读权限、依赖、账户身份、快照口径和错误边界；通过 CI 后，代码随 KanBan 应用版本一起发布。官方集成的用户界面只展示平台、版本、状态和源码仓库链接。目录级别与核心解耦，发布级别仍受 KanBan 版本控制。

官方构建会把 `plugins/` 下的集成编译到 `dist/plugins/packages/`，生产运行时从该构建目录加载，不从 `data/source-plugins/` 读取代码。独立进程仍然用于隔离供应商实现和保留长桥 OAuth 状态，但它不是操作系统安全沙箱。

## 创建和验证

在本仓库的功能分支中创建目录；外部贡献者先在自己的 KanBan Fork 中创建，再提交 PR。可以复制 [`plugins/template/`](../../plugins/template/) 后改名为 `plugins/<provider>/` 作为起点，但必须按当前协议实现并补齐真实的只读权限校验：

```text
plugins/<provider>/
├── manifest.json       # 稳定 ID、版本、能力和入口
└── src/
    └── main.ts        # stdio 进程入口
```

入口清单中的 `entry` 使用 `.mjs`，源码入口使用同名 `.ts`。构建器会把入口及其本地依赖编译到 `dist/plugins/packages/<provider>/`，并拒绝依赖 `src/server/`。运行时通过 `plugins/sdk/stdio-server.ts` 提供的 `serveAssetSourcePlugin` 接收逐行 JSON-RPC 2.0 请求，插件实现 `AssetSourcePlugin` 的 `read`、`authorize`、`revalidate`，需要服务能力时再实现受限的 `call`。

stdout 只能输出协议消息，调试信息写 stderr，不能输出凭证。普通请求最多运行 60 秒，响应缓冲最多 8 MiB；超时或取消时核心可以终止进程。

新增官方集成要同步三个位置：

1. `plugins/<provider>/manifest.json` 和对应源码目录；
2. [`src/server/asset-source-plugins/official.ts`](../../src/server/asset-source-plugins/official.ts) 的运行白名单；
3. [`plugins/official.json`](../../plugins/official.json) 的设置页演示元数据。

第二、三处必须使用相同的稳定 ID。`pnpm plugins:verify` 会在 CI 中拒绝清单不一致、构建包缺失或初始化握手不匹配的改动。

不要把数据库句柄、应用加密密钥或交易能力交给集成。权限只允许 `account`、`positions`、`market-data` 和 `public-address`；不能声明或调用交易、划转、提现和签名能力。只读声明不能证明用户提供的 API Key 真的没有额外权限，因此测试时仍需使用专用测试凭证。

## 清单和表单

```json
{
  "id": "plugin:my-provider",
  "version": "1.0.0",
  "protocolVersion": 1,
  "entry": "plugins/<provider>/src/main.mjs",
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
      { "id": "apiKey", "label": "只读 API Key", "control": "text", "required": true }
    ],
    "previewScope": "现货账户及余额；不支持合约。"
  }
}
```

第三方 ID 使用 `plugin:<名称>`，但官方版本不会加载它。字段只描述数据，不执行集成提供的 HTML 或浏览器脚本；完整清单约束以[清单验证器](../../src/server/asset-source-plugins/manifest.ts)和[协议类型](../../plugins/sdk/protocol.ts)为准。

## 授权和快照

授权结果应包含稳定的供应商账户身份、只读权限、明确的账本归属和首次真实快照。账户 ID 不能使用 API Key 或其指纹冒充。预览与确认时重新读取，账户、权限和范围必须一致。

金额、数量和汇率使用十进制字符串，不能使用浮点数或科学计数法。缺价保持 `null`，不能补零；覆盖未知或部分支持时使用 `unknown` / `partial` 并说明产品范围；读取失败不能伪造空账户。平台权威总额与已包含的持仓明细不能重复相加。财务口径以 [CONTEXT](../../CONTEXT.md) 为准，快照结构见[资产合同](../../src/server/ports/assets.ts)和[快照校验器](../../src/server/asset-source-plugins/snapshot-validation.ts)。

## 进入官方版本

自定义集成不能通过压缩包、GitHub Release、官方清单或设置页进入官方应用。若希望官方支持：

1. 将源码、清单和必要的离线测试放入本仓库的独立集成目录；
2. 提交 PR，说明供应商权限、账户范围、数据口径和已知限制；
3. 通过类型检查、离线单测、构建和安全审查；
4. 由维护者合入，随下一版 KanBan 一起构建和发布。

应用构建会生成 `dist/plugins/packages/`，生产运行时只从该目录加载官方集成。官方集成不单独发布 Release，用户不需要安装、更新、停用、卸载或回滚插件。

独立进程只是代码组织和运行生命周期边界，不是安全沙箱。任何进入官方版本的集成都必须按“会接触所有者凭证”的高风险代码审查；未审查的实现只能在开发者自己的 Fork 和隔离数据目录中运行。
