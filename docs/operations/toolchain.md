# 已验证工具链

当前复现基线为 macOS arm64、Node 24.15.0、pnpm 11.25.0、Rust 1.97.1。Node/pnpm 精确固定以避免把单次验证变成整条版本线的兼容承诺；升级需重新执行安装、类型检查、单测、应用和 CLI 验收。

Node 使用内置 SQLite、模块 hooks 和实验性类型转换；CLI 的实验性警告不是失败。pnpm 由 packageManager 和锁文件约束。Rust edition 2024、N-API 8、longbridge-oauth 本地补丁只影响原生产物编译。Rust/Cargo/codesign 属于构建工具，持有兼容签署产物的运行环境无需 Cargo。

本机以 Homebrew rustc 1.97.1 编译并加载；未强制安装 rustup，不声明 Windows/Linux 已验收。版本检查发生在安装、应用启动和 CLI 加载入口，错误包含切换指引。
