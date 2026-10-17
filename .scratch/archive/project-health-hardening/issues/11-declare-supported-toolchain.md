# 11 — 声明并验证运行时与包管理器版本

Status: resolved
Type: task
Priority: 低
Phase: 立即处理（低成本项）
Evidence: 确定存在版本声明缺口
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 07](../../../active/project-health-hardening-delivery/issues/07-declare-verified-toolchain.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

项目依赖 Node SQLite 和实验性类型转换运行 TS，但没有 engines、packageManager 或 Node 版本文件；Rust edition 与本地补丁也需要明确兼容工具链。

**审查证据：** 审查包清单未声明 engines/packageManager，也未发现 .nvmrc。Node 24.15 是复现使用版本，不等于整个项目已经在该版本完成验收。

**位置（模块/函数）：** 包元数据、Node 脚本启动前提与原生 Cargo edition / patch 配置。

## Solution

降低新环境安装与 CLI 启动的不可复现性。

**修改风险：** 低。

## User Stories

1. 作为所有者，我希望声明并验证运行时与包管理器版本，以便降低新环境安装与 CLI 启动的不可复现性。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 依据现有依赖、脚本和实际验证结果声明支持的 Node 版本范围及包管理器版本；不得把未验证版本直接写成唯一承诺。
- 结合原生清单的 edition 和本地补丁记录已验证 Rust 工具链；清楚区分构建时需求和纯运行时需求。
- 为不支持环境提供尽早且可理解的诊断，避免到数据库或认证导入阶段才失败。

## Testing Decisions

沿用包脚本契约和 CLI 子进程验收，增加必要环境边界样例；真实构建结果单独记录。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 冻结锁文件安装在声明环境可复现；类型检查、默认单元测试、CLI 启动和相关构建验收与声明一致。
- [ ] 不支持的 Node 环境得到明确兼容性错误；不存在要求不存在的 API 的宽泛版本范围。
- [ ] 包管理器声明与锁文件匹配，原生编译所需版本与运行启动需求分别说明。

## Out of Scope

不顺带升级全部依赖，不承诺未验证的多平台支持。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [package.json](../../../../package.json)
- [pnpm-lock.yaml](../../../../pnpm-lock.yaml)
- [native/longbridge-keychain-sdk/Cargo.toml](../../../../native/longbridge-keychain-sdk/Cargo.toml)
- [scripts/run-local-next.mjs](../../../../scripts/run-local-next.mjs)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
