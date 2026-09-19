# 已验证工具链

当前复现基线为 macOS arm64、Node 24.15.0、pnpm 11.25.0、Rust 1.97.1。Node/pnpm 精确固定以避免把单次验证变成整条版本线的兼容承诺；升级需重新执行安装、类型检查、单测、应用和 CLI 验收。

Node 使用内置 SQLite、模块 hooks 和实验性类型转换；CLI 的实验性警告不是失败。pnpm 由 packageManager 和锁文件约束。Rust edition 2024、N-API 8、longbridge-oauth 本地补丁只影响原生产物编译。Rust/Cargo/codesign 属于构建工具，持有兼容签署产物的运行环境无需 Cargo。

本机以 Homebrew rustc 1.97.1 编译并加载；未强制安装 rustup，不声明 Windows/Linux 已验收。版本检查发生在安装、应用启动和 CLI 加载入口，错误包含切换指引。

## 原生产物

首次准备或 Rust 源码/Cargo.lock/本地补丁变化后运行 pnpm native:longbridge:build。构建以 --locked 运行 Cargo，复制并签署产物后写入本机 artifact.json；其记录源文件指纹、二进制摘要、平台、架构、Node 和 N-API。产物和清单均忽略，不进入 Git。

pnpm dev/start 只校验并加载扩展公开接口，不调用 Keychain 查询或 Cargo；缺失或不兼容时明确报错，不能自动退回明文存储。pnpm build 仍为显式构建链。复制部署时同时带上签署 .node 和 artifact.json。
