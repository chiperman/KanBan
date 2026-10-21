# 组件规范：接口、状态与交互

组件视觉由 [vibe-components.css](../../src/app/vibe-components.css) 拥有，React 接口在 [src/ui/vibe/](../../src/ui/vibe/)。产品页面复用这些组件，不重复配方。本文定义合同，实际差异见 [backlog](../backlog.md)。

维护与验证范围见 [设计契约](../../DESIGN.md#变更与验证)。

---

## 状态映射

状态先有可辨识标记与明确文字，再用颜色增强。下表是业务状态到视觉色调的映射建议，不是组件状态枚举，也不替代领域状态机。

| 业务状态 | 标签色调 | 用于 |
|---|---|---|
| 空闲 / 待分类 | `muted` | 未开始、无待处理信号 |
| 运行中 | `live` | 同步中、刷新中 |
| 需要输入 | `signal` | 需要决策、需要授权 |
| 完成 | `success` | 已完成、已刷新 |
| 待确认 | `warning` | 需要注意或核定 |
| 失败 | `error` | 失败、不可读 |

实际 `VibeStatusTag.tone` 为 `muted | live | signal | success | warning | error`，默认 `muted`，接口位于 [vibe-data-instrument.tsx](../../src/ui/vibe/vibe-data-instrument.tsx)。不要把色调当作供应商、同步或授权状态。

---

## 按钮与名称链接

```
<button class="vibe-button vibe-button--primary|outline|text" data-vibe-component="button">
```

React 页面使用 [VibeButton / VibeLink](../../src/ui/vibe/vibe-button.tsx)，不手写同款按钮类名或用页面 CSS 重建外观。既有登录与首次供给页的专用按钮沿用现有范围，不据此扩大共享按钮的豁免。组件 API 的封闭语义是：

| 属性 | 取值 | 用途 |
|---|---|---|
| `variant` | `primary` / `outline` / `text` | 主操作 / 次级操作 / 轻量操作 |
| `size` | `regular` / `compact` | 标准高度 / 紧凑芯片与工具条 |
| `shape` | `default` / `square` | 常规按钮 / 图标按钮 |
| `tone` | `default` / `danger` | 常规语义 / 危险操作；危险仍是描边，不是红色填充 |

| 变体 | 视觉 | 用于 |
|---|---|---|
| `--primary` | `--display` 填充 + `--bg` 文字（黑白反转） | 每屏至多一个主操作 |
| `--outline` | `--line-2` 边框 | 次级操作（**默认变体**） |
| `--text` | 仅文字，水平内边距收到 4px | 取消、更多操作 |

- 标签用 `--f-mono`，字距 `.04em`，字号 `--vibe-type-label`（11px）。
- 圆角 `--r-sm`（6px），标准高 44px。
- 悬停 `opacity .8`；按下 `.6`；禁用 `.3`。**悬停永不变色。**
- 焦点环：`outline: 2px solid var(--primary)`，`offset 3px`。

**禁止**：红色按钮。主按钮不是红色——红色是信号位，不是操作位。

页面与组件的样式归属见 [设计契约](../../DESIGN.md#源码归属)；`display` 等布局属性允许页面处理，不借此覆盖按钮视觉。`tone="danger"` 允许语义前景色，仍不使用红色填充。

### 名称链接 · `VibeEntityLink`

账户、来源名称进入详情时使用 [VibeEntityLink](../../src/ui/vibe/vibe-entity-link.tsx)，共享 `.vibe-entity-link` 配方。名称始终带下划线，末尾使用同套线形右箭头，不依赖悬停或颜色表达可点击；键盘焦点环与按钮一致，长名称可换行，箭头不压缩。名称使用正文排版，执行操作继续使用 `VibeButton` / `VibeLink`。

---

## 输入字段与下拉选择

接口为 [VibeField / VibeTextareaField / VibeSelectField](../../src/ui/vibe/vibe-field.tsx)。字段标签必须关联真实输入，不能只靠 placeholder 命名；错误用文字说明并按需关联 `aria-describedby` / `aria-invalid`。

```
<div class="vibe-field">
  <label class="vibe-field__label" for="…">标签</label>
  <input class="vibe-field__input" id="…" />
</div>
```

- 标签：`--f-mono`、`--vibe-type-micro`（10px）、全大写、字距 `.12em`、色 `--secondary`。
- 输入框：1px `--line-2` 边框、`--r-sm` 圆角、透明底、`--primary` 文字、`--f-mono`。
- 当前输入配方至少 48px 高，字号 `--vibe-type-body`（16px）。
- **聚焦只把边框色改为 `--primary`**：没有发光、没有强调色、没有阴影。
- 占位符 `--muted`；禁用 `opacity .3`。
- 多行变体 `textarea.vibe-field__input` 最小高 112px，字距收到 `.02em`，行高 1.55。

### 下拉选择 · `.vibe-select`

```
<div class="vibe-select vibe-select--compact|--wide">
  <button class="vibe-select__trigger" aria-expanded="false"><span>当前值</span><span class="vibe-select__chevron"></span></button>
  <div class="vibe-select__options">
    <button class="vibe-select__option" aria-selected="true">选项<span class="vibe-select__selected-mark"></span></button>
  </div>
</div>
```

- 触发器至少 44px 高，字号 `--vibe-type-body-xs`（13px）；展开时底色转 `--raised`，边框转 `--primary`，箭头旋转 180°。输入与选择器的密度取舍见 backlog，不把二者写成已经统一。
- 选中项底色 `--raised`，右侧 6×6 方块用 `--accent` 标记。这是沿用上游的限定例外，不扩展到按钮、标签页或整个选项填充。
- 面板挂在 portal 中，`z-index: 101`。
- 键盘支持 `Enter` / `Space` 展开、方向键移动、`Esc` 收起；标签、展开状态和选中状态可被读屏识别。

## 复选行 · `.vibe-choice`

```
<label class="vibe-choice"><input type="checkbox" /><span>说明</span></label>
```

选中态是**边框转 `--display` + 底色 `--raised`**，不是上色。18×18 的原生 checkbox 用 `accent-color: var(--display)`。

## 设置偏好选择卡片

设置中需要比较效果的互斥偏好统一使用 `.settings-choice` 单选卡片，例如盈亏颜色、走势图点阵。即使底层值是布尔值，也应把两个状态明确展示为可选项，不在同类设置中混用方形复选框或另绘勾选标记。可同时选中多个条目的场景继续使用复选行。

- 一组使用 `fieldset.settings-choice-group` 与 `legend`，选项放入 `.settings-choice-list`；每张卡片由 `label.settings-choice` 包裹同组 `name` 的原生 `input type="radio"`，整张卡片可点击，并保留原生键盘与焦点行为。
- 单选圆点为 18×18，使用 `accent-color: var(--display)`；选中时卡片边框为 `--display`、底色为 `--raised`，未选中时为 `--line` 边框与透明底。各项复用同一配方，不通过强调色区分选中态。
- `.settings-choice-copy` 承载选项名称与说明；`.settings-choice-preview` 展示该选项对应的固定示例，选中与未选中的选项均保留各自预览，便于直接比较。示例不读取真实资产数据，对读屏隐藏，选项含义由可访问的名称与说明表达。
- 复用 [现有布局](../../src/app/product-layout.css) 的双列与窄屏单列规则，不为单个偏好另设尺寸、边框或选中态。实际调用者为 [盈亏颜色](../../src/ui/profit-color-settings.tsx) 与 [走势图点阵](../../src/ui/trend-appearance-settings.tsx)。

---

## 状态标签 · `.vibe-status-tag`

```
<span class="vibe-status-tag vibe-status-tag--{muted|live|signal|success|warning|error}">
  <i aria-hidden="true"></i>文本
</span>
```

- 可见高 24px，1px `--line-2` 边框，`--r-sm` 圆角，`--f-mono` `--vibe-type-micro`，全大写，字距 `.06em`。
- 内含 6px 圆点作为状态载体。
- **色调分工**：`muted` 与 `success` 的文字保持次级灰，**只有圆点承担颜色**；`signal` 与 `error` 才让整个标签上色。

这是本产品"先形状与标签、后颜色"原则最直接的体现。

---

## 分段条 · `.vibe-segmented-bar`

```
<div class="vibe-segmented-bar" role="img" aria-label="…">
  <span class="is-filled is-primary is-group-1"></span>
  …
</div>
```

- 离散方格、2px 间隙、**直角无圆角**。空槽是 `--line-2` 的低透明度版本。
- 填充 `--display`；`is-group-1/2/3` 用透明度（1 / .72 / .48）区分相邻来源段。
- `is-muted` 用于"已知但未计入"的段；`is-signal`（`--accent`）与 `is-error`（`--error`）**只用于越限与不可读**。
- 总是与一个数值读数并置——**分段条不能单独承担信息**。
- 组件自动按 `total` 把 `segments` 折算到格数；`total` 为 0 时全部为空槽（不是全满）。

---

## 主数值 · `.vibe-metric`

```
<div class="vibe-metric">
  <span class="vibe-metric__value"><span class="vibe-live-counter">1,234,567.89</span></span>
  <span class="vibe-metric__unit">USD</span>
</div>
```

- 数值用 `--f-display`（Doto）、`tabular-nums`、字重 500、字距 `-.045em`、行高 .95。
- 单位回落到 `--f-mono` `--vibe-type-label`（11px）、色 `--secondary`。
- 计数动画：1200ms、三次缓动、`IntersectionObserver` 阈值 0.6、遵守减弱动效偏好。
- `aria-label` 必须是**最终值**，而不是动画中间值。

> 注意：`.vibe-live-counter` 与 `.vibe-metric__value` **本身没有样式**，视觉完全来自父级 `.vibe-metric`。不要为它们另写样式。

---

## 内联通知 · `.vibe-notice`

```
<div class="vibe-notice vibe-notice--{error|success|info}">
  <span class="vibe-notice__marker" aria-hidden="true"></span>
  <div class="vibe-notice__content">
    <strong class="vibe-notice__code">SYNC FAILED</strong>
    <div class="vibe-notice__message">说明文本</div>
  </div>
</div>
```

- [VibeNotice](../../src/ui/vibe/vibe-notice.tsx) 接口为 `tone="error" | "success" | "info"`、可选 `code` 与正文 `children`。
- 状态标记遵守 [项目适配](../../DESIGN.md#项目适配)，边界保持中性。可保留约 9% 的局部语义底色（`color-mix`）；`info` 使用 `--raised`，不增加彩色强调。
- 使用 6px 实心圆点配合正文或 `code` 中的明确状态文字；`error` / `success` 圆点使用对应状态色，`info` 使用 `--primary`。圆点对读屏隐藏，保留原图标占位与内容对齐。
- `--compact` 变体用于卡片内，宽度收缩为 `max-content`。
- 当前组件不自动声明 live region。调用者按消息紧急程度传入 `role="status"` / `aria-live`，确需即时错误播报时使用 `role="alert"`，避免重复播报。

通知使用内联形式，不以浮动 toast 飞入后消失。实际页面的人工核验见 [backlog](../backlog.md#通知状态标记人工验收)。

---

## 对话框 · `.vibe-dialog`

复用 [VibeDialog](../../src/ui/vibe/vibe-dialog.tsx)。

```
<div class="vibe-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="…">
  <section class="vibe-dialog">
    <header class="vibe-dialog__header">…<h2>标题</h2></header>
    <div class="vibe-dialog__body"><p class="vibe-dialog__copy">说明</p>…</div>
    <footer class="vibe-dialog__footer">取消 + 确认</footer>
  </section>
</div>
```

- 遮罩 `--overlay`，面板 1px `--line-2`、`--r-md`、`--surface`、**无阴影**。
- 标题 `--f-head` / 600，字号 `--vibe-type-subheading`（18px）；eyebrow 用 `--vibe-type-micro` 等宽大写。
- 页脚 = `.vibe-button--text` 取消 + `.vibe-button--primary` 确认。
- 行为：`Esc` 关闭、遮罩内焦点循环、打开时把焦点移入、关闭后归还原元素、锁定 body 滚动。
- 移动端（≤639px）遮罩贴底、面板 `max-height: calc(100dvh - 24px)`；来源向导类对话框升为全屏，页头页脚吸顶。

---

## 下拉菜单 · `.vibe-menu`

复用 [VibeMenu](../../src/ui/vibe/vibe-menu.tsx)。触发器用 `.vibe-button--text` + `.vibe-menu__trigger`（紧凑高 40px）。面板 `--surface` + `--line-2` + `--r-sm`，`z-index: 30`。

- 悬停底色 `--raised`，**不是强调色**。
- 危险项 `--vibe-menu__item--danger` 用 `--accent-text` 作为**前景色**，不是红底白字。
- 键盘：`ArrowDown/Up` 循环、`Home/End` 首尾、`Esc` 关闭并归还焦点、失焦即关闭。

## 提示 · `.vibe-tooltip`

复用 [VibeTooltip](../../src/ui/vibe/vibe-tooltip.tsx)，提示不承载完成操作所必需的唯一信息。

- 默认向下、水平居中；`data-align="end"` 靠右对齐。
- `--floating` 变体（`side="right"`）挂到 body，`z-index: 120`，滚动/缩放/`Esc` 即消失。
- 内容用 `--f-mono` `--vibe-type-label`（11px），底色 `--raised`，`--r-sm`。
- 触发器必须带 `aria-describedby` 指向提示节点。

## 验证码分格输入 · `.vibe-verification-code`

- 6 个 40×50px 槽位，用 Doto 承载数字；真实 `<input>` 透明覆盖其上，保证原生输入与无障碍。
- 复用 [VibeVerificationCode](../../src/ui/vibe/vibe-verification-code.tsx)，输入保留数字键盘与 `autocomplete="one-time-code"`；视觉槽位不重复进入读屏。
- 聚焦时当前槽边框转 `--primary`；`aria-invalid="true"` 时全部转 `--error`（绝不用"抖动"表达错误）。
- 宽度不足 360px 时槽位收窄到 36px。

## 日期字段 · `.vibe-date-field`

- 触发器 48px 高、`--r-sm`、Doto 数字、字距 `.12em`。
- 日历：`--surface` + `--line-2` + `--r-md`，日期用 Doto，**今天 = 反转填充**，已选 = `--display` 描边。
- 服务于"按上海自然日保存"的手工记录。日历本身不写入任何数据。
- 移动端 `max-width: calc(100vw - 24px)`。
- 复用 [VibeDateField](../../src/ui/vibe/vibe-date-field.tsx)，月切换与日期均可键盘到达；今天与已选状态可被读屏识别。

## 数据表 · `.vibe-data-table`

- 表头 `--vibe-type-micro` 等宽大写、`--muted`、下边界 `--line-2`。
- 单元格 `--f-mono` `--vibe-type-label`（11px）、下边界 `--line`、数值右对齐、文本左对齐。
- **无斑马纹。** 需要区分时用更多留白或分组细线。
- 不可读或未估值必须在文案上如实说明（“未估值”／“数据不足”），状态前景可用 `--error`，不以整行色底代替文字。使用表头与单元格语义，窄屏滚动及数值完整性见页面模式。

## 数据行与预览列表

- `.vibe-data-row`：下边界 `--line`，最后一行自动去掉边界。
- `.vibe-preview-list`：`dt` 用 `--vibe-type-micro` 等宽大写 `--muted`，`dd` 用 `--vibe-type-label`（11px）等宽 `--primary`。用于来源详情的授权摘要——**这里绝不回显凭证原文**，只显示授权范围与校验时间。

## 认证玻璃面 · `.vibe-auth-surface`

`--glass` + `backdrop-filter: blur(16px)`、`--r-md`、**无边框、无阴影**。用于锁定页与预置页的身份验证面板。

## 空态

内容结构为标题、一行说明与必要时的一个主操作；无操作可执行时不放无效按钮。不用插画、emoji 或多行长文案。

当前页面采用上下细线、透明底、无圆角的变体；上游为虚线边框与点阵字形。二者的采用取舍尚待设计核定，见 [backlog](../backlog.md#卡片空态与字段密度核定)。不要把未采用的上游配方写成已经实现。

## 通用交互与无障碍

- 使用原生按钮、链接与输入语义，Tab 顺序与视觉顺序一致，无键盘陷阱；所有操作均可键盘完成，拖拽提供等价的非拖拽路径。
- 图标有相邻文字时隐藏装饰语义；纯图标按钮必须有可访问名称。装饰 SVG 使用 `aria-hidden="true"` 与 `focusable="false"`。
- 不使用 `outline: none` 移除焦点而没有同等可见的替代。按钮焦点用 2px `--primary` 轮廓、外偏移 3px；菜单项用 2px 内轮廓，下拉选项用 1px 内轮廓；字段沿用聚焦配方。
- 命中区按 [基础规范](foundations.md#7-控件尺寸) 执行，触控目标之间至少留出 8px；不让轻薄轮廓缩小实际可点范围。
- 异步状态保留清楚的可见标签，按需增加读屏播报，不重复制造可见提示。错误不用抖动表达。
- 新组件先查现有组合；分段条、复选行和内联通知可继续承担已有场景。只有真实需求无法满足时才新增，并遵守同一 Token、语义与交互合同。
