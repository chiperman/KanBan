# 领域文档

以下规则说明工程技能在探索代码库时应如何使用本仓库的领域文档。

## 探索前阅读

- 仓库根目录的 **`CONTEXT.md`**；或
- 如果根目录存在 **`CONTEXT-MAP.md`**，则按其指向读取各上下文的 `CONTEXT.md`，只需阅读与当前主题相关的文件。
- **`docs/adr/`**：阅读与即将处理区域相关的 ADR。在 multi-context 仓库中，还需检查 `src/<context>/docs/adr/` 中该上下文专属的决策。

如果这些文件不存在，**静默继续**。不要提示缺失，也不要预先建议创建。`/domain-modeling` 技能（可通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 使用）会在术语或决策真正明确后按需创建这些文件。

## 文件结构

Single-context 仓库（适用于绝大多数仓库）：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context 仓库（根目录存在 `CONTEXT-MAP.md`）：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词汇

输出中命名领域概念时（例如 Issue 标题、重构提案、假设或测试名称），使用 `CONTEXT.md` 定义的术语。不要改用术语表明确避免的同义词。

如果术语表中没有所需概念，这通常意味着：你正在创造项目未使用的说法，应重新考虑；或这里确实存在缺口，应记录并交由 `/domain-modeling` 处理。

## 标记 ADR 冲突

如果输出与现有 ADR 冲突，应明确指出，而不是静默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重新讨论，因为……_
