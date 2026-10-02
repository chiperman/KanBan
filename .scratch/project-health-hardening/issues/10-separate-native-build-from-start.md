# 10 — 分离原生扩展构建与运行时启动

Status: resolved
Type: task
Priority: 中
Phase: 后续重构
Evidence: 确定存在启动耦合；实际额外时长待测
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 13](../../project-health-hardening-delivery/issues/13-separate-native-build-and-start.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

predev、prebuild、prestart 都执行原生 release 构建、复制与签名步骤，使已有产物的运行启动仍依赖构建工具链；尚未证明每次都是完整重编译。

**审查证据：** 包脚本和原生构建脚本确认三类生命周期均调用构建。审查未运行 Cargo，也未测量启动额外耗时。

**位置（模块/函数）：** predev / prebuild / prestart；原生构建脚本入口和扩展加载器。

## Solution

降低日常启动对 Rust 工具链和重复构建的依赖。

**修改风险：** 中：原生 ABI、架构和签名兼容性。

## User Stories

1. 作为所有者，我希望分离原生扩展构建与运行时启动，以便降低日常启动对 Rust 工具链和重复构建的依赖。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 将编译、产物准备和签名归入显式构建阶段；生产 start 验证兼容产物并加载，不隐式编译。
- 验证当前架构、Node 兼容性、扩展版本与必要签名条件；产物缺失/过期时提供明确错误和修复命令。
- 开发模式可保留显式按需构建路径；与工具版本声明协调，保持现有 macOS Keychain 的秘密边界。

## Testing Decisions

使用受控工具链子进程验证生命周期命令与错误传播；真实 macOS 产物加载作为单独集成验收，不读取所有者凭证。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 已有兼容产物时，生产启动不调用 Cargo，且只读来源/Keychain 集成入口可正常加载。
- [ ] 缺失、不兼容架构或过期产物启动明确失败，不静默使用错误二进制或回退明文秘密。
- [ ] 构建命令仍能生成可用产物；记录实际启动前后耗时，不能用假工具链测试替代真实原生验收。
- [ ] 单元级脚本测试不调用真实编译/签名；必要真实构建只在实施验收阶段按变更范围执行。

## Out of Scope

不新增 Windows/Linux 支持、不重写 OAuth、不在规格阶段执行原生构建。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [package.json](../../../package.json)
- [scripts/build-longbridge-keychain-sdk.mjs](../../../scripts/build-longbridge-keychain-sdk.mjs)
- [src/server/asset-sources/longbridge-keychain-sdk.ts](../../../src/server/asset-sources/longbridge-keychain-sdk.ts)
- [native/longbridge-keychain-sdk/Cargo.toml](../../../native/longbridge-keychain-sdk/Cargo.toml)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
