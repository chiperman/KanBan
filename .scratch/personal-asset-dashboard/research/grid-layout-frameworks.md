# 三列资产卡片自由布局：框架调研

**日期：** 2026-07-27
**范围：** 仅评估已认证资产看板的编辑模式；桌面三列、卡片宽度 1/2/3 格、可落入任意空位、拖动中显示全部合法落位、落位时可改变跨度、卡片高度由内容决定。未改产品代码。

## 结论

推荐采用 **CSS Grid + `@dnd-kit` + 小型自有占位/碰撞算法**，而不是引入完整 dashboard-grid 框架。

原因是这组交互的决定性要求不是普通“排序”，而是二维不规则占位：每张卡片的 `span` 为 1/2/3，空位是否可用须同时满足横向连续空格、当前内容的自然高度和不覆盖既有卡片；拖动中还要一次标出**所有**可用位置。GridStack 与 react-grid-layout 都已提供拖拽、尺寸与压缩，但其公开模型以离散行高 `h` 为主，不能直接把卡片的自然高度当作二维占位高度；官方资料也没有“枚举并同时高亮所有合法落点”的现成功能。用 dnd-kit 保留拖放、键盘和无障碍基础能力，布局真相由 CSS Grid 与纯函数 `canPlace(card, x, y, span)` 掌握，最贴合产品语义且避免 DOM 命令式框架与 React 状态相互争夺。

建议的数据模型保持逻辑顺序与跨度，而不持久化像素高度：`{ id, order, span: 1 | 2 | 3, startsNewRow? }`。编辑态根据当前三列及已占用位置计算候选区域；以每个候选区域的覆盖层显示合法/非法，激活候选改变预览 `span`，`onDragEnd` 才提交 `order/span`。浏览态由 CSS Grid 的 `grid-column: span n` 和内容自身高度渲染；中/窄屏仍从同一顺序重排为两列/一列。这是实现建议，不是本次代码变更。

## 需求匹配表

| 方案 | 1/2/3 格宽 + 拖拽/改宽 | 任意空位与所有合法落点 | 内容自然高度 | React / Next.js 代价 | 判断 |
| --- | --- | --- | --- | --- | --- |
| **CSS Grid + dnd-kit** | 可实现；跨度是原生 `grid-column`，拖放由 dnd-kit 提供 | 可实现，但须自写占位矩阵、碰撞检测与候选覆盖层 | **原生支持** | React hooks 友好；客户端编辑器包裹即可 | **推荐** |
| **react-grid-layout v2** | 原生支持 `w/h`、拖拽、缩放、边界与可关闭压缩 | 单一当前拖放/碰撞由库处理；“全部候选”需额外实现 | 不原生；`h × rowHeight`，需测量内容后回写行数 | React 原生、SSR 兼容；但会把自然高度需求转成固定行系统 | 次选，仅当接受离散行高 |
| **GridStack** | 原生 widget `x/y/w/h`、拖拽、缩放、列数/浮动布局 | 可允许保留空洞；全部候选仍需自写 | 有 `resizeToContent` 思路，但仍受行高网格约束 | React 需要包装/生命周期桥接，库直接控制 DOM | 不推荐作为本需求主方案 |
| **Muuri（替代方案）** | 拖拽、排序、动画强；宽度通常交给 CSS/自定义 layout | 不是 1/2/3 单元占位引擎；候选区域需自行建模 | 支持不等高布局 | 命令式 DOM API；React 需要包装 | 不适合精确跨度规则 |

## 各方案核对

### 1. GridStack

- 官方定位就是互动 dashboard；widget 序列化示例包含 `x/y/w/h`，并提供移动、尺寸调整、外部拖入及移动端触摸支持。[官方 README](https://github.com/gridstack/gridstack.js)
- 官方 API 提供 `float`，其语义是关闭自动向上压缩、从而保留空洞；这比普通排序更接近“任意空位”。但它仍是基于 `x/y/w/h` 的行列引擎，且官方使用 `cellHeight` 作为网格尺度。[GridStack API：float](https://gridstackjs.com/doc/html/classes/GridStack.html#float)、[cellHeight](https://gridstackjs.com/doc/html/classes/GridStack.html#cellHeight)
- 官方 API 有 `resizeToContent`，可在内容变化时调高 widget 的行数；这不是浏览态的真正自然高度，仍会把高度量化成网格行，且可能推动下方卡片。[GridStack API：resizeToContent](https://gridstackjs.com/doc/html/classes/GridStack.html#resizeToContent)
- React 集成属于 GridStack 实例与 React 渲染的桥接：官方 README 指向 React component/example，并要求用 `renderCB` 创建内容，不再直接以字符串 HTML 渲染。[官方 README：React / render callback](https://github.com/gridstack/gridstack.js#readme)

**适用边界：** 若产品改为固定 12px/24px 行高的运营仪表盘，并接受内容高度被量化，GridStack 可最快落地。当前“卡片内容自然高且并排不拉等高”的约束与它不吻合。

### 2. react-grid-layout（RGL）v2

- RGL 是 React 专用的可拖拽、可缩放、响应式网格；官方列出拖拽/缩放、边界检查、可关闭压缩、序列化恢复、SSR 和 StrictMode 兼容。[官方 README：特性](https://github.com/react-grid-layout/react-grid-layout#features)
- 新项目应使用 v2 hooks；其 `gridConfig` 明确包含 `cols` 与 `rowHeight`，布局项示例是 `x/y/w/h`。因此三列时可限制 `w: 1..3`，但高度仍以 `h` 个 `rowHeight` 表示。[官方 README：v2 API](https://github.com/react-grid-layout/react-grid-layout#whats-new-in-v2)、[Quick Start](https://github.com/react-grid-layout/react-grid-layout#quick-start)
- RGL 内置 `noCompactor`，可关闭自动压缩并保留位置；它也暴露 `useGridLayout` 以接管 drag/resize/drop state。两者足以做定制，但“全部合法落位高亮”和自然高度需要在库外再实现，且会和其行高模型叠加。[官方 README：Compactor](https://github.com/react-grid-layout/react-grid-layout#compactor)、[useGridLayout](https://github.com/react-grid-layout/react-grid-layout#usegridlayout)
- Next.js 应采用客户端组件，并使用官方 `useContainerWidth`/`measureBeforeMount` 处理容器测量与 SSR 首次渲染；这可解决宽度测量，不会解决自然高度的行高约束。[官方 README：useContainerWidth](https://github.com/react-grid-layout/react-grid-layout#usecontainerwidth)

**适用边界：** 若将“高度自适应”改为“内容测量后向上取整到若干行”，RGL 是四者中最贴合 React 的现成选择。否则它会为当前很轻量的三列卡片引入不必要的二维坐标与高度持久化。

### 3. dnd-kit

- dnd-kit 官方定义为拖、放、排序与重排的可扩展基础设施，支持 React 与传感器、修饰器；它不是 widget/grid layout 引擎。[官方概览](https://dndkit.com/)
- Sortable 官方预设支持 grids，但提供的是排序策略与碰撞算法；文档建议为排序选择 `closestCenter` / `closestCorners` 等策略。它没有定义 `w/span/h` 或空位矩阵，正好意味着可以按本产品的 `span` 与自然高度写自己的规则，而不必逆向改造框架。[官方 Sortable 文档](https://dndkit.com/legacy/presets/sortable/overview/)
- “显示全部合法区域”应实现为：拖动开始时计算所有 `(row, column, span)` 候选；每一个候选都是可访问的 droppable/视觉 overlay；碰撞检测仅从这些候选中选激活项。这是使用 dnd-kit 的扩展点实现，不是官方开箱功能。选择自有算法的代价是要自行测试键盘操作、触摸、滚动与布局变更后的重新测量。

**适用边界：** 最符合本题。仅在编辑模式加载，正常浏览仍是简单 CSS Grid；不会把布局生命周期交给外部 widget 引擎。

### 4. Muuri（必要替代方案）

- Muuri 官方定位为响应式、可排序、可过滤、可拖拽、可动画的 JavaScript layout engine；支持不同高度的项目、跨 grid 拖拽、自动滚动和自定义 layout。[官方 README](https://github.com/haltu/muuri#readme)
- 其项目以绝对定位和库自身的布局/动画生命周期工作，README 明确要求 item 的 `position: absolute` 并警告不要在项目上加 CSS transition；这与 React/CSS Grid 的声明式布局不自然。[官方 README：样式要求](https://github.com/haltu/muuri#add-the-styles)
- 它没有把“列跨度为 1/2/3、格点占位与合法区域枚举”作为第一等模型。可借自定义 layout 实现，但那会重写本题最核心的算法，同时还要维护 React DOM 同步。

**结论：** 不选。它适合瀑布流/自由动画编排，不适合需要可解释、可持久化的三列跨度规则。

## Efferd 的定位

Efferd 是**视觉/组件块参考，不是布局框架**。其官网将产品说明为 shadcn blocks，强调“代码在项目中而非 node_modules”，通过 shadcn registry 安装单个 block；文档也只说明 registry 与 `shadcn add @efferd/...` 的使用方式。[Efferd 首页](https://efferd.com/)、[Efferd 文档](https://efferd.com/docs)

因此可继续借鉴其 dashboard 的卡片层级、间距、颜色和信息密度，但不能期待它提供拖拽、占位、碰撞、跨度或布局持久化。现有 Issue 17 对它“负责卡片层级、留白和现代 Dashboard 结构”的定义正确，应保持该边界。

## 落地前的验收要点

1. 桌面编辑态：分别拖动 1、2、3 格卡片，验证所有可占的连续空格都出现预览，任何会重叠/越界的位置都不出现为可落点。
2. 落位：选择不同候选时，预览宽度随候选的 `span` 改变；松手后只持久化顺序/跨度，刷新后一致。
3. 高度：相邻卡片内容长短不同，不被拉成相同高度；内容异步变长后不改变其跨度，不产生覆盖。
4. 响应式：同一逻辑顺序在两列/一列重排；跨度在当前列数上限内裁剪，不维护第二套桌面坐标。
5. 可访问性：编辑模式才启用拖拽；有键盘移动/取消路径和可读的候选状态，浏览模式无误拖。
