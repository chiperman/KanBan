# 03 · 组件规范

组件层由 `src/app/vibe-components.css` 拥有，React 接口在 `src/ui/vibe/`。产品页面**必须**消费这些组件，不得在页面内重复配方。

所有样张都可在 `styleguide.html` 的「组件」章节中看到真实渲染。

---

## 1. 统一状态机

全站共用五个状态名，**不得另造**。表达顺序恒为 **形状 → 标签 → 颜色**。

| 状态 | 形状 | 标签色调 | 用于 |
|---|---|---|---|
| `idle` | 灰色静态点 | `muted` | 未开始、空闲、待分类 |
| `running` | 白色点脉冲 | `live` | 同步中、刷新中 |
| `needs-input` | 信号红点 | `signal` | 需要决策、需要授权 |
| `done` | 实心点 | `success` | 已完成、已刷新 |
| `error` | 描边点 | `error` | 失败、不可读 |

颜色是**第三层**信息。色盲用户必须能在只有形状与文字的情况下完成操作。

---

## 2. 按钮 · `.vibe-button` / `VibeButton` / `VibeLink`

```
<button class="vibe-button vibe-button--primary|outline|text" data-vibe-component="button">
```

React 页面必须消费 `src/ui/vibe/vibe-button.tsx` 的 `VibeButton` / `VibeLink`，不得手写同款按钮类名或用页面 CSS 重建按钮外观。组件 API 的封闭语义是：

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

**禁止**：页面级选择器覆盖按钮的 `display`、背景、文字色、边框、圆角、字号、行高、内边距、阴影、透明度或过渡。页面 CSS 只能负责按钮的放置、宽高伸缩、间距和响应式显隐；视觉语义由 `vibe-components.css` 唯一拥有。新增页面覆盖会被 `pnpm design:lint` 的 `page-button-override` 规则拦截。

---

## 3. 输入字段 · `.vibe-field`

```
<div class="vibe-field">
  <label class="vibe-field__label" for="…">标签</label>
  <input class="vibe-field__input" id="…" />
</div>
```

- 标签：`--f-mono`、`--vibe-type-micro`（10px）、全大写、字距 `.12em`、色 `--secondary`。
- 输入框：1px `--line-2` 边框、`--r-sm` 圆角、透明底、`--primary` 文字、`--f-mono`。
- **聚焦只把边框色改为 `--primary`**：没有发光、没有强调色、没有阴影。
- 占位符 `--muted`；禁用 `opacity .3`。
- 多行变体 `textarea.vibe-field__input` 最小高 112px，字距收到 `.02em`，行高 1.55。

## 4. 下拉选择 · `.vibe-select`

```
<div class="vibe-select vibe-select--compact|--wide">
  <button class="vibe-select__trigger" aria-expanded="false"><span>当前值</span><span class="vibe-select__chevron"></span></button>
  <div class="vibe-select__options">
    <button class="vibe-select__option" aria-selected="true">选项<span class="vibe-select__selected-mark"></span></button>
  </div>
</div>
```

- 触发器标准高 44px；展开时底色转 `--raised`，边框转 `--primary`；箭头旋转 180°。
- 选中项底色 `--raised`，右侧 6×6 方块用 `--accent` 标记——**这是极少数允许用红的场合**，因为它表达"当前选择"这一信号。
- 面板挂在 portal 中，`z-index: 101`。

## 5. 复选行 · `.vibe-choice`

```
<label class="vibe-choice"><input type="checkbox" /><span>说明</span></label>
```

选中态是**边框转 `--display` + 底色 `--raised`**，不是上色。18×18 的原生 checkbox 用 `accent-color: var(--display)`。

---

## 6. 状态标签 · `.vibe-status-tag`

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

## 7. 分段条 · `.vibe-segmented-bar`

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

## 8. 主数值 · `.vibe-metric`

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

## 9. 内联通知 · `.vibe-notice`

```
<div class="vibe-notice vibe-notice--{error|success|info}">
  <点阵图标 />
  <div class="vibe-notice__content">
    <strong class="vibe-notice__code">SYNC FAILED</strong>
    <div class="vibe-notice__message">说明文本</div>
  </div>
</div>
```

- 这是**唯一**允许状态色填充一块区域的场合：图标 + 3px 左边界 + 约 9% 的色底（`color-mix`）。
- `--info` 用 `--line-2` 边界 + `--raised` 底，不使用颜色。
- 图标：`error → error`、`success → check`、`info → key`（9×9 点阵字形）。
- `--compact` 变体用于卡片内，宽度收缩为 `max-content`。

**上游明确不用浮动 toast。** 状态以内联形式常驻，而不是动画飞入后消失。

---

## 10. 对话框 · `.vibe-dialog`

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

## 11. 下拉菜单 · `.vibe-menu`

触发器用 `.vibe-button--text` + `.vibe-menu__trigger`（紧凑高 40px）。面板 `--surface` + `--line-2` + `--r-sm`，`z-index: 30`。

- 悬停底色 `--raised`，**不是强调色**。
- 危险项 `--vibe-menu__item--danger` 用 `--accent-text` 作为**前景色**，不是红底白字。
- 键盘：`ArrowDown/Up` 循环、`Home/End` 首尾、`Esc` 关闭并归还焦点、失焦即关闭。

## 12. 提示 · `.vibe-tooltip`

- 默认向下、水平居中；`data-align="end"` 靠右对齐。
- `--floating` 变体（`side="right"`）挂到 body，`z-index: 120`，滚动/缩放/`Esc` 即消失。
- 内容用 `--f-mono` `--vibe-type-label`（11px），底色 `--raised`，`--r-sm`。
- 触发器必须带 `aria-describedby` 指向提示节点。

## 13. 验证码分格输入 · `.vibe-verification-code`

- 6 个 40×50px 槽位，用 Doto 承载数字；真实 `<input>` 透明覆盖其上，保证原生输入与无障碍。
- 聚焦时当前槽边框转 `--primary`；`aria-invalid="true"` 时全部转 `--error`（绝不用"抖动"表达错误）。
- 宽度不足 360px 时槽位收窄到 36px。
- 这是本产品唯一自行组合的输入控件，其余输入统一走 `.vibe-field`。

## 14. 日期字段 · `.vibe-date-field`

- 触发器 48px 高、`--r-sm`、Doto 数字、字距 `.12em`。
- 日历：`--surface` + `--line-2` + `--r-md`，日期用 Doto，**今天 = 反转填充**，已选 = `--display` 描边。
- 服务于"按上海自然日保存"的手工记录。日历本身不写入任何数据。
- 移动端 `max-width: calc(100vw - 24px)`。

## 15. 数据表 · `.vibe-data-table`

- 表头 `--vibe-type-micro` 等宽大写、`--muted`、下边界 `--line-2`。
- 单元格 `--f-mono` `--vibe-type-label`（11px）、下边界 `--line`、数值右对齐、文本左对齐。
- **无斑马纹。** 需要区分时用更多留白或分组细线。
- 不可读/未估值的行整体转 `--error`（`.is-unvalued`），并在文案上如实说明（"未估值"／"数据不足"）。

## 16. 数据行与预览列表

- `.vibe-data-row`：下边界 `--line`，最后一行自动去掉边界。
- `.vibe-preview-list`：`dt` 用 `--vibe-type-micro` 等宽大写 `--muted`，`dd` 用 `--vibe-type-label`（11px）等宽 `--primary`。用于来源详情的授权摘要——**这里绝不回显凭证原文**，只显示授权范围与校验时间。

## 17. 认证玻璃面 · `.vibe-auth-surface`

`--glass` + `backdrop-filter: blur(16px)`、`--r-md`、**无边框、无阴影**。用于锁定页与预置页的身份验证面板。

## 18. 空态

规范配方：**虚线细线边框 + 9×9 点阵字形 + `--f-head` 标题 + 一行说明 + 一个主按钮**。

**不用插画、不用 emoji、不写多行长文案。**

> 该配方目前尚未组件化，且现网实现（`product-layout.css:5349`）使用的是"上下 1px 细线 + 透明底 + 无圆角"的变体，与配方不一致。已登记为组件缺口。

---

## 19. 不可用组件（缺口）

上游契约中存在、本产品尚未组件化的能力。**补做时必须沿用上游语义，不得另起命名。**

| 缺口 | 上游契约 |
|---|---|
| 开关 Switch | 药丸轨道 + 圆旋钮；ON = `--display` 轨道 + `--bg` 旋钮（黑白反转，不用红） |
| 滑块 Slider | 细轨道 + 圆旋钮，填充与旋钮用 `--display` |
| 仪表 Gauge | 细环 + 刻度环 + 居中 Doto 数字，`%` 紧随数字不换行 |
| 标签页 / 分页 | `.tabs` 2px `--display` 下划线；`.pager` 用 Doto 页码 |
| 线性进度 | `.lp`：`--display` 填充 |
| 横幅 Banner | 默认反转填充；`.sig` 红底白字**仅限需要决策的消息** |
| 空态 | 见上一节配方 |
| 点阵标点 / 25×25 字形 | 见 [`02-dot-matrix-and-background.md`](02-dot-matrix-and-background.md) |

已有替代关系：分段条承担了进度与仪表的表达；内联通知承担了横幅；`.vibe-choice` 承担了单选项。
