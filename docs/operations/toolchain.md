# 已验证工具链

当前复现基线为 macOS arm64、Node 24.15.0、pnpm 11.25.0、Rust 1.99.0（构建脚本亦兼容 1.97.1）。Node/pnpm 精确固定；升级时检查安装及受影响的应用、CLI 或原生产物，不默认扩大到无关验收。

版本配置见 [package.json](../../package.json)、[.node-version](../../.node-version) 和 [pnpm 锁文件](../../pnpm-lock.yaml)。首次准备与日常启动见 [开发入口](../../README.md#开发入口)，各脚本、命令与自动钩子见 [脚本索引](../../scripts/README.md)；本文维护环境与产物合同。

Node 使用内置 SQLite、模块 hooks 和实验性类型转换；CLI 的实验性警告不是失败。pnpm 由 packageManager 和锁文件约束。Rust edition 2024、N-API 8、longbridge-oauth 本地补丁只影响原生产物编译。Rust/Cargo/codesign 属于构建工具，持有兼容签署产物的运行环境无需 Cargo。

本机以 Homebrew rustc 1.99.0 编译并加载；未强制安装 rustup，不声明 Windows/Linux 已验收。版本检查发生在安装、应用启动和 CLI 加载入口，错误包含切换指引。

## 原生产物

首次准备或 Rust 源码/Cargo.lock/本地补丁变化后运行 `pnpm native:longbridge:build`。构建以 `--locked` 运行 Cargo，复制并签署产物后写入本机 `artifact.json`；其记录源文件指纹、二进制摘要、平台、架构、Node 和 N-API。产物和清单均忽略，不进入 Git。

`pnpm dev` / `pnpm start` / `pnpm build` 不强制构建或加载原生 SDK，CLI 连接可独立运行。首次使用 SDK 时才检查源指纹、摘要和公开接口；缺失或不兼容时明确提示构建，不自动执行 Cargo、修复 Keychain 或退回明文存储。Keychain 需修复时显式运行 `pnpm longbridge:keychain:repair`。复制需要 SDK 的运行副本时同时带上签署 `.node` 和 `artifact.json`。

源码在 [native/longbridge-keychain-sdk/](../../native/longbridge-keychain-sdk/)，其中 [vendor/longbridge-oauth/](../../native/longbridge-keychain-sdk/vendor/longbridge-oauth/) 是 [Cargo 实际引用](../../native/longbridge-keychain-sdk/Cargo.toml) 的本地补丁源码。该目录及两处 Cargo 锁文件保留在版本控制中；两个 `target/` 目录属于本机编译生成物，不与补丁源码混同。

## 后台运行环境

`pnpm runtime:prepare` 在存在原生产物时校验并复制，无产物时允许准备仅 CLI 的副本；独立安装依赖并执行应用生产构建，不会重复编译 Rust。运行副本、端口和正式数据与开发分离，安装步骤见 [后台自动采集](service-composition.md#后台自动采集)。

后台入口加载运行副本的 `.env.local`，要求绝对路径 `KANBAN_DATA_DIR`；launchd 显式提供 Node 路径、PATH 与正式数据目录。网络环境准备后另起 Node 进程，使 Node 内置代理在初始化时生效。网页登录会话不参与采集，来源凭证、服务端加密密钥、CLI 登录与登录钥匙串仍须有效；来源授权失效不会由网页登录自动修复。
