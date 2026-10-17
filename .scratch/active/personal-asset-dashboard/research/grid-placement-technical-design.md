# 资产卡片网格级放置技术方案

**状态：** implemented
**日期：** 2026-07-27
**范围：** 已认证资产看板的资产卡片拖拽；不改资产业务、不改卡片内容、不改服务端布局数据结构。

## 1. 决策摘要

采用：

- CSS Grid 继续负责浏览态三列、两列、单列排版与内容自然高度。
- 固定使用 `@dnd-kit/core@6.3.1`，负责指针、触控、键盘拖拽、DragOverlay、Droppable 与取消流程。
- 新增一个纯函数深模块 `CardLayoutPlanner`，负责枚举和提交三列网格中的合法落点。
- Efferd、Nothing、Bloomberg Terminal 只负责视觉职责，不参与布局计算。
- 拖到窄于原卡片的空位时允许自动缩小，并在放下前明确显示 `3 → 1` 或 `3 → 2`。
- 首版只允许自动缩小，不自动放大；放大继续使用右下角宽度手柄。

不采用：

- 不引入 GridStack 或 react-grid-layout。
- 不持久化 `x`、`y`、像素高度或离散行高。
- 不把资产卡片改为绝对定位。
- 不重做已经正常工作的卡片宽度手柄。
- 不重新引入全局“布局编辑模式”；仍通过明确的排序手柄进入拖拽。

框架比较与官方来源见 [grid-layout-frameworks.md](./grid-layout-frameworks.md)。

## 2. 用户体验目标

拖动任意资产卡片时：

1. 页面立即显示当前网格内全部合法落点。
2. 两格卡片右侧的一格空位必须成为可见、可点击和可放置的候选区域。
3. 未激活候选使用浅灰点线；当前候选才使用 Nothing signal red 实线。
4. 当前候选红框表示卡片放下后的真实宽度和内容高度。
5. 当目标宽度小于当前宽度时，显示例如 `SPAN 3 → 1 · COL 3`。
6. 松手才同时提交顺序与宽度；按 `Escape` 或拖出有效区域则取消。
7. 保存失败时恢复拖动前布局并显示内联错误。

## 3. 当前问题

当前 `OwnerDashboard` 把以下职责集中在一个文件中：

- Pointer capture。
- DOM 卡片克隆与拖动浮层。
- 命中测试。
- “插到某张卡片前或后”的顺序计算。
- 红色占位框渲染。
- 乐观保存和失败回滚。

当前拖拽接口实际上只有：

```ts
{
  dropIndex: number;
  startsNewRow: boolean;
}
```

`previewDragging()` 通过 `document.elementFromPoint()` 寻找鼠标下方的卡片。长桥卡片右侧空白处没有 `data-layout-card-id`，因此不会产生新落点，只会保留原来的顺序候选或跳到末尾新行。

需要把“按卡片命中”提升为“按逻辑网格候选命中”。

## 4. 领域与持久化边界

### 4.1 持久化模型保持不变

继续保存：

```ts
type PersistedCardLayout = {
  id: string;
  span: 1 | 2 | 3;
  startsNewRow?: boolean;
};
```

数组顺序就是桌面逻辑顺序。

现有接口继续使用：

```text
PUT /api/asset-cards/layout
```

服务端继续验证：

- 必须包含全部资产卡片。
- ID 不重复且不能包含未知卡片。
- `span` 只能为 1、2、3。
- `startsNewRow` 只能为布尔值。

不需要数据库迁移、数据兼容迁移或新路由。

### 4.2 拖拽坐标只是临时模型

拖拽候选可以包含行列坐标，但不能持久化：

```ts
type DropCandidate = {
  id: string;
  kind: "reorder" | "fill-gap" | "new-row";
  insertIndex: number;
  row: number;
  columnStart: number;
  span: 1 | 2 | 3;
  previousSpan: 1 | 2 | 3;
  startsNewRow: boolean;
};
```

提交候选时，将它转换回：

- 新数组顺序。
- 拖动卡片的新 `span`。
- 拖动卡片是否 `startsNewRow`。

其他卡片的字段保持不变。

隐藏资产卡片不参与网格候选计算，但仍必须存在于完整保存数组。提交时只替换原数组中的可见卡片槽位，隐藏卡片保持原槽位、相对顺序及全部字段，避免恢复显示后顺序意外漂移。

## 5. 模块设计

### 5.1 深模块：`CardLayoutPlanner`

建议路径：

```text
src/ui/card-layout/card-layout-planner.ts
```

外部接口只暴露两个函数：

```ts
export function planDropCandidates(input: {
  cards: LayoutCard[];
  draggedId: string;
  columns: 1 | 2 | 3;
  allowAdaptiveShrink: boolean;
}): DropPlan;

export function applyDropCandidate(
  cards: LayoutCard[],
  candidate: DropCandidate,
): LayoutCard[];
```

模块内部隐藏：

- CSS Grid 稀疏自动排布模拟。
- 行、列和连续空格计算。
- 插入位置枚举。
- `startsNewRow` 处理。
- 自适应缩小规则。
- 候选去重与优先级。
- 新行候选生成。

调用者不需要理解算法，只需要渲染 `DropPlan.candidates` 并提交一个候选。

### 5.2 dnd-kit 是实现细节

不为 dnd-kit 创建额外 port 或 adapter：

- 当前只有一个拖拽实现。
- 测试不需要替换 dnd-kit 为第二种生产实现。
- 额外抽象只会形成浅模块。

dnd-kit 位于 UI 模块内部，`CardLayoutPlanner` 保持无 DOM、无 React、无第三方依赖。

### 5.3 建议文件结构

```text
src/ui/card-layout/
├── card-layout-planner.ts
├── card-layout-editor.tsx
└── card-drop-zone-layer.tsx
```

职责：

- `card-layout-planner.ts`：纯布局算法和提交转换。
- `card-layout-editor.tsx`：DndContext、sensors、拖拽状态机和保存协调。
- `card-drop-zone-layer.tsx`：渲染全部候选区域和活动红框。
- `card-layout-editor.tsx` 内的 DragOverlay：复用只读 React 卡片内容，随目标宽度实时重排，不渲染操作手柄。

`OwnerDashboard` 只负责：

- 提供卡片数据。
- 渲染卡片内容。
- 接收布局提交结果。
- 调用现有保存接口。

## 6. 候选生成算法

### 6.1 基础排布模拟

实现纯函数：

```ts
packLayout(cards, columns)
```

输入只包含顺序、`span`、`startsNewRow`。

规则必须与现有 CSS Grid 一致：

1. 当前可视跨度为 `min(card.span, columns)`。
2. `startsNewRow` 时从下一逻辑行第一列开始。
3. 当前行剩余列不足时进入下一行。
4. 不使用像素高度参与逻辑排布。
5. 输出每张卡片的 `row`、`columnStart`、`span`。

### 6.2 枚举可表达的布局结果

拖拽开始后：

1. 从卡片数组中暂时移除被拖动卡片。
2. 枚举所有合法 `insertIndex`。
3. 首先使用原 `span` 模拟布局。
4. 桌面三列下，再依次尝试更小的跨度。
5. 根据模拟结果取得拖动卡片最终行、列和跨度。
6. 以 `(row, columnStart, span)` 去重。
7. 对每个逻辑位置保留变化最小的候选。

这比直接保存 `x/y` 更稳定，因为每个候选都是现有顺序模型能够真实持久化的结果。

### 6.3 候选显示优先级

优先级从高到低：

1. 保持原跨度并填入现有空位。
2. 保持原跨度并改变顺序。
3. 缩小跨度后填入原本无法容纳的行尾空位。
4. 保持原跨度进入新行。

限制：

- 自适应缩小只在原跨度无法进入该连续空位时出现。
- 空白新行只显示保持原跨度的候选，避免无理由缩小。
- 不产生自动放大候选。
- 不显示会越界、重叠或不能映射回数组顺序的候选。

示例：

```text
当前行：[长桥 span-2][空 1 格]
拖动：演示资产 span-3

候选：
row=0, columnStart=2, span=1, previousSpan=3
标签：SPAN 3 → 1 · COL 3
```

## 7. 几何与视觉层

### 7.1 候选命中区域

拖拽开始时一次性测量：

- 网格边界。
- 当前列数。
- column gap。
- 单列宽度。
- 每个逻辑行的顶部和底部。

总资产概览不属于可持久化资产卡片，已移出资产卡片 Grid，避免 Planner 的 `row=0` 与页面实际纵向原点错位。活动候选通过把被拖动卡片放入真实 CSS Grid 预览顺序，由浏览器计算最终位置和自然高度；候选层读取该隐藏卡片的真实几何，不自行推算纵向高度。

候选区域的横向几何由逻辑列计算：

```ts
left = columnStart * (columnWidth + gap);
width = span * columnWidth + (span - 1) * gap;
```

Pointer move 期间不重新扫描所有卡片 DOM，只让 dnd-kit 在已经生成的 Droppable 候选中做碰撞检测。

窗口尺寸、媒体查询列数或卡片集合变化时重新生成候选。

### 7.2 高度策略

需要区分两种高度：

- 非活动候选：表示“这里可以放”，命中范围使用当前逻辑行高度。
- 活动红框：表示“放下后的真实卡片”，高度使用 DragOverlay 在目标宽度下重新排版后的实际高度。

DragOverlay 宽度随候选跨度变化：

```text
span-3 → span-1
```

内容自然换行后测量浮层高度，再同步给活动红框。

因此在两格长桥卡片右侧：

- 浅灰候选可以覆盖整条空白列，方便命中。
- 红色活动框只显示演示卡片实际落地高度。
- 不会用长桥卡片的 599px 高度误导用户。

### 7.3 Nothing 视觉规则

非活动候选：

- 1px 浅灰点线或点阵角标。
- 无红色填充。
- 不与真实卡片争夺层级。

活动候选：

- 2px `#D71921` 实线。
- 最多 4% 红色透明背景。
- Space Mono 小标签：`SPAN 3 → 1 · COL 3`。
- 无阴影、无模糊、无弹簧动画。

拖动卡片：

- 使用真实 React 内容，不再 `cloneNode()`。
- opacity 约 0.88。
- 宽度与目标候选同步。
- 动画使用 120–180ms ease-out。

`prefers-reduced-motion` 下取消位移动画。

## 8. dnd-kit 接入

首版只引入：

```text
@dnd-kit/core
```

暂不引入 `@dnd-kit/sortable`，因为本需求不是简单的一维列表排序。

传感器：

- PointerSensor：设置轻微 activation distance，避免点击操作按钮时误拖。
- KeyboardSensor：使用自定义坐标 getter，在候选区域之间移动。
- 触控沿用 PointerSensor，并启用合理的滚动行为。

核心结构：

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={candidateCollisionDetection}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={handleDragCancel}
>
  <CardGrid />
  <CardDropZoneLayer />
  <DragOverlay>
    <CardDragOverlay />
  </DragOverlay>
</DndContext>
```

自定义碰撞策略：

1. 优先使用 pointer-within。
2. 指针不在候选内时使用 rect intersection，支持拖动浮层覆盖候选。
3. 多候选同时命中时按候选优先级和距离选择。
4. 只接受 `CardLayoutPlanner` 提供的合法候选。

## 9. 拖拽状态机

```text
IDLE
  ↓ pointer/keyboard pickup
DRAGGING
  ↓ enter candidate
PREVIEWING
  ↓ move between candidates
PREVIEWING
  ↓ drop
SAVING
  ├─ success → IDLE
  └─ failure → ROLLBACK → IDLE

DRAGGING/PREVIEWING
  └─ Escape/cancel → IDLE
```

状态数据：

```ts
type DragSession = {
  draggedId: string;
  originalCards: Card[];
  plan: DropPlan;
  activeCandidateId: string | null;
  overlayHeight: number;
  saveState: "idle" | "saving";
};
```

拖动期间只更新 `activeCandidateId`，不持续写服务端。

候选变化时可以本地生成 `previewCards`，让其余卡片以 FLIP 动画展示放下后的重排结果。

## 10. 保存、一致性与失败处理

### 10.1 正常提交

1. `applyDropCandidate()` 生成下一份卡片数组。
2. 前端乐观显示新布局。
3. 调用现有布局 PUT。
4. 成功后结束会话。

### 10.2 保存失败

- 恢复 `originalCards`。
- 显示内联错误“布局保存失败，已恢复原布局”。
- 不自动重试。

### 10.3 拖动期间数据变化

资产来源可能在拖动期间被新增、隐藏或删除。

提交前比较当前卡片 ID 集合与 `originalCards`：

- 完全一致：允许提交。
- 已变化：取消拖动并提示“资产来源已变化，请重新调整布局”。

避免用旧数组覆盖新来源。

## 11. 响应式规则

### 桌面：三列

- 显示全部网格候选。
- 允许落位时自动缩小。
- 保持 1/2/3 格持久化。

### 中等宽度：两列

- 允许排序。
- 视觉跨度裁剪为最多两列。
- 不通过拖动改变持久化 `span`，避免在中屏意外修改桌面布局。

### 手机：单列

- 只提供上下排序。
- 不显示横向候选。
- 不改变持久化 `span`。

三种宽度共用同一份数组顺序，不维护独立布局。

## 12. 键盘与无障碍

排序手柄必须支持：

- `Space` / `Enter`：拿起卡片。
- 方向键：在候选区域间移动。
- `Enter`：放下。
- `Escape`：取消。

使用 live region 宣告：

```text
已拿起演示资产，当前宽度 3 格。
候选：第 1 行第 3 列，宽度从 3 格调整为 1 格。
已放置并保存。
```

其他要求：

- 浏览模式下卡片本体不可误拖。
- 所有操作仍从独立手柄开始。
- 红色不能成为唯一状态表达。
- 候选标签必须包含文字变化。

## 13. 测试方案

### 13.1 纯模块测试

新建：

```text
e2e/card-layout-planner.spec.ts
```

虽然复用 Playwright Test runner，但不启动页面交互，只测试模块接口。

覆盖：

1. `[span-2][空 1]` 为 `span-3` 拖动卡片生成 `3 → 1` 候选。
2. 原跨度可容纳时优先保持跨度。
3. 空白新行不自动缩小。
4. 不生成自动放大候选。
5. 候选不越过列边界。
6. `startsNewRow` 结果与 CSS Grid 模拟一致。
7. 相同逻辑落点正确去重。
8. 应用候选只改变顺序、拖动卡片跨度和必要的换行标记。
9. 两列、单列模式不改变桌面持久化跨度。

### 13.2 浏览器级测试

扩展：

```text
e2e/card-layout-responsive.spec.ts
```

覆盖：

1. 拖动开始后全部合法候选同时出现。
2. 长桥两格卡片右侧显示一格候选。
3. 悬停右侧时显示完整红框和 `3 → 1`。
4. 放下后卡片与长桥卡片同行，间距正确。
5. 两张卡片保持各自内容高度。
6. 刷新后顺序和跨度保持。
7. `Escape` 不保存任何变化。
8. 保存失败恢复原布局。
9. 键盘可以选择相同候选。
10. 中屏、手机不会意外修改桌面跨度。
11. 未认证状态不渲染拖拽能力。

### 13.3 真实浏览器验收

桌面 1280px，浅色和深色分别验证：

- 一格、两格、三格卡片。
- 行尾一格、两格空位。
- 新行。
- 长内容和短内容并排。
- 拖动滚动页面。
- 控制台无应用错误。

自动化通过不替代这一步人工视觉验收。

## 14. 实施顺序

### 阶段 1：纯布局模块

- 添加 `CardLayoutPlanner`。
- 先写失败测试，再实现候选枚举和提交转换。
- 不接 UI。

### 阶段 2：dnd-kit 基础接入

- 安装并锁定经过 React 19 / Next.js 生产构建验证的 `@dnd-kit/core` 版本。
- 用 DragOverlay 替换 DOM `cloneNode()`。
- 先保持当前前后排序能力等价。

### 阶段 3：网格候选层

- 渲染全部合法候选。
- 接入行尾空格与新行区域。
- 删除巨大的单一末尾 drop target。

### 阶段 4：自适应宽度

- 接入 `3 → 2`、`3 → 1`、`2 → 1`。
- 活动浮层按目标宽度重排并同步真实高度。
- 松手时同时保存顺序和跨度。

### 阶段 5：键盘、失败回滚与响应式

- 完成 KeyboardSensor。
- 完成 live region。
- 完成并发卡片变化保护。
- 完成两列、单列降级。

### 阶段 6：清理与验收

- 删除旧 Pointer drag、clone、elementFromPoint 和单一 dropIndex 实现。
- 保留独立宽度调整手柄。
- 运行 typecheck、生产构建、布局专项测试和全量 Playwright。
- 完成真实 Chrome 浅色/深色视觉验收。

## 15. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 候选过多导致视觉噪音 | 非活动候选只用浅灰点线，只有一个活动红框 |
| 自适应缩小让用户意外 | 明确显示 `SPAN 3 → 1`，松手前不保存 |
| DragOverlay 高度和落地高度不同 | 浮层按目标宽度真实重排并测量 |
| 拖动时大量 DOM 测量卡顿 | 候选和几何在 drag start 计算，pointer move 只做碰撞 |
| 中屏操作改变桌面布局 | 中屏和手机只排序，不持久化跨度变化 |
| 新增来源被旧布局覆盖 | 提交前比较卡片 ID 集合，不一致则取消 |
| 第三方库升级影响行为 | 将业务规则封装在纯 `CardLayoutPlanner`，dnd-kit 只负责输入 |

## 16. 完成标准

以下条件全部满足才算完成：

- 长桥两格卡片右侧的一格空位始终可见、可选、可放。
- 拖动时全部合法区域可见，非法区域不可提交。
- 自适应跨度变化在松手前有明确文字和红框预览。
- 卡片高度始终由内容决定。
- 服务端布局模型和接口保持兼容。
- 中屏、手机继续使用同一桌面顺序。
- 鼠标、触控、键盘和取消路径均可用。
- 保存失败和拖动期间数据变化不会破坏布局。
- 生产构建、全量自动化和真实浏览器验收均通过。

## 17. 已确认的默认决策

本方案默认：

1. 自动适配只缩小，不自动放大。
2. 只有桌面三列模式允许拖动改变跨度。
3. 所有候选区域可见，但只有当前候选使用红色。
4. 不建立独立桌面坐标模型，继续保存顺序、跨度和换行。

以上四点已按默认决策实现。

## 18. 实施记录

- 新增纯函数 `CardLayoutPlanner`，公开候选规划与提交转换两个 seam。
- 用 dnd-kit 替换旧 Pointer capture、DOM `cloneNode()`、`elementFromPoint()` 和末尾大目标。
- 支持全部候选可见、活动候选红框、`3 → 1` 自适应缩小、真实自然高度和刷新后持久化。
- 支持 Pointer、Keyboard、`Escape` 取消、保存失败回滚和拖动期间卡片集合变化保护。
- 底部始终生成显式新行候选；即使末行仍有连续空位，也可选择 `startsNewRow: true` 强制另起一行。
- 候选命中区与结果预览分离：同一行只使用互不重叠的单格命中区，底部新行命中区固定在真实卡片底边之后；红色完整跨度预览不参与碰撞与重新测量。
- 同一行同一列存在多个自适应跨度时，只保留能放下的最大跨度，避免完全重合的候选互相抢占。
- 两列、单列模式仅排序，不改写桌面持久化跨度。
- 自动化证据：Planner 5 项，布局与响应式浏览器验收 12 项，合计 17 项专项测试通过。
- 真实 Chromium 视觉验收覆盖 1280px 浅色与深色：候选层、活动红框、`3 → 1` 标签、目标自然高度和 DragOverlay 指针位置均符合预期。
