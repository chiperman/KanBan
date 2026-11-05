# 组件规范：接口、状态与交互

组件视觉由 [vibe-components.css](../../src/app/vibe-components.css) 拥有，React 接口在 [src/ui/vibe/](../../src/ui/vibe/)。产品页面复用这些组件，不重复配方。本文定义合同，实际差异见 [backlog](../backlog.md)。

维护与验证范围见 [设计契约](../../DESIGN.md#变更与验证)。

---

## 状态映射

状态先有可辨识标记与明确文字，再用颜色增强。业务状态统一按下表映射视觉色调；映射不替代领域状态机。

| 业务状态 | 标签色调 | 用于 |
|---|---|---|
| 空闲 / 未配置 | `muted` | 未开始、未配置、尚未检测、主动断开或停止、普通元信息 |
| 运行中 | `live` | 同步中、刷新中 |
| 需要输入 | `signal` | 需要决策的操作提示 |
| 正常 / 完成 | `success` | 正常、已连接、已启用、已授权、已完成、已刷新 |
| 待确认 / 待更新 | `warning` | 覆盖待核定、过期或保留行情、延迟行情、重连中、等待行情 |
| 失败 / 不可用 | `error` | 同步或采集失败、授权失效、账户不一致、行情不可用、不可读、未估值、总额不完整、日结不完整或错过窗口 |

实际 `VibeStatusTag.tone` 为 `muted | live | signal | success | warning | error`，默认 `muted`，接口位于 [vibe-data-instrument.tsx](../../src/ui/vibe/vibe-data-instrument.tsx)。不要把色调当作供应商、同步或授权状态。

- 同一事实在标签、通知与设置摘要中使用同一语义色。明确失败不能降为黄色或普通信息；尚未配置不当作失败。异常中断使用红色，主动断开使用灰色。
- 汇总先展示明确错误，其次待确认；没有异常且有正常证据时使用绿色，没有来源或尚无记录时使用灰色。不能仅凭没有错误字段推断成功。
- 完整总额中的“部分产品仅汇总”可使用绿色；“持仓行情未接入，账户总额已包含”是灰色能力说明，总额有效但明细部分可见使用黄色。尚未关注资产的读取限制以待确认为主，已关注资产无法读取使用红色。
- 连接生命周期、同步结果和实时通道检测各自着色；“已连接”不证明同步或实时检测成功，详见 [来源连接与管理](patterns.md#来源连接与管理)。
- 页面不得用遗留状态类或高优先级颜色覆盖共享组件的 `tone`。

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
| `wrap` | `boolean`，默认 `false` | 长内容允许自然换行及断开连续字符，高度随内容增长；沿用共享字体、颜色与焦点配方 |

| 变体 | 视觉 | 用于 |
|---|---|---|
| `--primary` | `--display` 填充 + `--bg` 文字（黑白反转） | 每屏至多一个主操作 |
| `--outline` | `--line-2` 边框 | 次级操作（**默认变体**） |
| `--text` | 仅文字，水平内边距收到 4px | 取消、更多操作 |

- 标签用 `--f-mono`，字距 `.04em`，字号 `--vibe-type-label`（12px）。
- 圆角 `--r-sm`（4px），标准高 44px。
- 主操作、导航与区间按钮的选中态统一黑白反转：深色为白底黑字，浅色为黑底白字，不使用灰色填充表示选中。
- 悬停 `opacity .8`；按下 `.6`；禁用 `.55`。常规操作保持中性色。
- 焦点环：`outline: 0.5px solid var(--primary)`，`offset 3px`。

**禁止**：红色按钮。主按钮不是红色——红色是信号位，不是操作位。

页面与组件的样式归属见 [设计契约](../../DESIGN.md#源码归属)；`display` 等布局属性允许页面处理，不借此覆盖按钮视觉。`tone="danger"` 允许语义前景色，仍不使用红色填充。

### 名称链接 `VibeEntityLink`

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

- 标签：`--f-mono`、`--vibe-type-micro`（12px）、西文大写、正常字距、色 `--secondary`。
- 输入框：0.5px `--line-2` 边框、`--r-sm` 圆角、透明底、`--primary` 文字、`--f-mono`。
- 当前输入配方至少 48px 高，字号 `--vibe-type-body`（16px）。
- `VibeField density="compact"` 用于工具条的短数字输入：44px 高、字号 `--vibe-type-body`（16px），隐藏数字步进按钮；其他字段保持默认配方。
- **聚焦只把边框色改为 `--primary`**：没有发光、没有强调色、没有阴影。
- 手工资产与投资记账金额使用 [VibeAmountField](../../src/ui/vibe/vibe-amount-field.tsx)，复用写入端校验规则；资产余额最多两位小数，投资记录最多八位，入金与出金必须大于零。失焦或提交后在字段旁显示错误并关联读屏说明，修正输入时更新提示；不以禁用保存按钮代替校验。
- 金额输入与错误反馈作为同一布局单元，使用紧邻输入的错误文字；按当前规则提示随宽度和字号自然换行的尺寸预留反馈空间。提示出现、清除或从空值提示切换为格式提示时，不改变表单高度或移动操作目标；预留内容不参与读屏，实际错误通过关联说明和礼貌播报提供。
- 占位符 `--muted`；禁用 `opacity .55`。
- 多行变体 `textarea.vibe-field__input` 最小高 112px，字距收到 `.02em`，行高 1.55。

### 下拉选择 `.vibe-select`

```
<div class="vibe-select vibe-select--compact|--wide">
  <button class="vibe-select__trigger" aria-expanded="false"><span>当前值</span><span class="vibe-select__chevron"></span></button>
  <div class="vibe-select__options">
    <div class="vibe-select__listbox" role="listbox">
      <button class="vibe-select__option" role="option" aria-selected="true">选项<span class="vibe-select__selected-mark"></span></button>
    </div>
  </div>
</div>
```

- 触发器至少 44px 高，字号 `--vibe-type-body`（16px）；展开时底色转 `--raised`，边框转 `--primary`，箭头旋转 180°。
- 选中项底色 `--raised`，右侧 6×6 方块用 `--accent` 标记。这是沿用上游的限定例外，不扩展到按钮、标签页或整个选项填充。
- 面板挂在 portal 中，`z-index: 101`。
- 键盘支持 `Enter` / `Space` 展开、方向键移动、`Home` / `End` 到首尾、`Esc` 收起并归还焦点；`Tab` / `Shift+Tab` 收起后沿原字段顺序继续，不逐项遍历选项。标签、展开状态和选中状态可被读屏识别。
- 选中状态只由受控值决定；值不在选项中时显示「请选择」，不把第一项显示或标记为已选，也不自动触发选择。展开时优先聚焦已选项，无匹配项时聚焦首项；业务回退或提交限制由状态所属调用方处理。
- 展开期间更新选项或受控值，保留仍存在的导航焦点；焦点项移除后回到已选项或首项，不自动改写选中值。没有可选项时显示「暂无可选项」，焦点留在列表区域，仍支持 `Esc` 和 `Tab`；选项恢复后聚焦已选项或首项。
- 当前值和选项中的长名称允许换行，完整保留名称、焦点轮廓与选中标记，面板只需纵向滚动。弹层按实际尺寸定位，名称或可用空间变化后重新测量，保持在视口内。

## 复选行 · `.vibe-choice`

```
<label class="vibe-choice"><input type="checkbox" /><span>说明</span></label>
```

选中态是**边框转 `--display` + 底色 `--raised`**，不是上色。18×18 的原生 checkbox 用 `accent-color: var(--display)`。

## 设置偏好选择卡片

设置中需要比较效果的互斥偏好统一使用 `.settings-choice` 单选卡片，例如盈亏颜色、走势图点阵。即使底层值是布尔值，也应把两个状态明确展示为可选项，不在同类设置中混用方形复选框或另绘勾选标记。可同时选中多个条目的场景继续使用复选行。

- 一组使用 `fieldset.settings-choice-group` 与 `legend`，选项放入 `.settings-choice-list`；每张卡片由 `label.settings-choice` 包裹同组 `name` 的原生 `input type="radio"`，整张卡片可点击，并保留原生键盘与焦点行为。
- 单选圆点为 18×18，使用 `accent-color: var(--display)`；选中时卡片边框为 `--display`、底色为 `--raised`，未选中时为 `--line` 边框与透明底。各项复用同一配方，不通过强调色区分选中态。
- `.settings-choice-copy` 仅承载选项名称；`.settings-choice-preview` 展示该选项对应的固定示例，选中与未选中的选项均保留各自预览，便于直接比较。示例不读取真实资产数据，对读屏隐藏，选项含义由可访问名称表达，不重复解释预览。
- 复用 [现有布局](../../src/app/product-layout.css) 的双列与窄屏单列规则，不为单个偏好另设尺寸、边框或选中态。实际调用者为 [盈亏颜色](../../src/ui/profit-color-settings.tsx) 与 [走势图点阵](../../src/ui/trend-appearance-settings.tsx)。

---

## 状态标签 · `.vibe-status-tag`

```
<span class="vibe-status-tag vibe-status-tag--{muted|live|signal|success|warning|error}">
  <i aria-hidden="true"></i>文本
</span>
```

- 可见高 24px，0.5px `--line-2` 边框，`--r-sm` 圆角，`--f-mono` `--vibe-type-micro`，全大写，字距 `.06em`。
- 内含 6px 圆点作为状态载体。
- **色调分工**：`muted` 与 `success` 的文字保持次级灰，`success` 用绿点标记正常；`signal`、`warning` 与 `error` 的圆点及文字使用对应语义色。
- 长桥授权页的账户行使用无框、随内容收拢的状态文字，保留圆点与色调；文字采用 `--f-ui`、`--vibe-type-body-sm` 和原始大小写，版本说明沿用次级小字。

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
- 单位回落到 `--f-mono` `--vibe-type-label`（12px）、色 `--secondary`。
- 金额计数默认静态显示最终值；不以滚动过程延迟用户读取。
- `VibeLiveCounter` 可用 `paused` 暂停并保留当前显示值，解除后从该值接续；默认不暂停。
- `aria-label` 必须是**最终值**，而不是动画中间值。
- 调用方将完整展示值与 `masked` 一并传给 `VibeMetric`，不先把金额替换为遮罩。组件统一显示六个圆点，并用不含真实数字、对读屏隐藏的占位保留读数与遮罩所需的宽高；长金额换行及 200% 文字下切换隐私状态时，读数区域和币种位置保持稳定。数据不足等不可用提示由调用方保留。

> 数值字体与排版继承父级 `.vibe-metric`；内部读数与占位的布局由共享配方管理，页面不另行估算金额宽度或覆盖内部布局。

---

## 内联通知 · `.vibe-notice`

```
<div class="vibe-notice vibe-notice--{error|success|warning|info}">
  <span class="vibe-notice__marker" aria-hidden="true"></span>
  <div class="vibe-notice__content">
    <strong class="vibe-notice__code">SYNC FAILED</strong>
    <div class="vibe-notice__message">说明文本</div>
  </div>
</div>
```

- [VibeNotice](../../src/ui/vibe/vibe-notice.tsx) 接口为 `tone="error" | "success" | "warning" | "info"`、可选 `code` 与正文 `children`。
- 状态标记遵守 [项目适配](../../DESIGN.md#项目适配)，边界保持中性。可保留约 9% 的局部语义底色（`color-mix`）；`info` 使用 `--raised`，不增加彩色强调。
- 使用 6px 实心圆点配合正文或 `code` 中的明确状态文字；`error` / `success` / `warning` 圆点使用对应状态色，`info` 使用 `--primary`。圆点对读屏隐藏，保留原图标占位与内容对齐。
- `--compact` 变体用于卡片内，宽度收缩为 `max-content`。
- 当前组件不自动声明 live region。调用者按消息紧急程度传入 `role="status"` / `aria-live`，确需即时错误播报时使用 `role="alert"`，避免重复播报。

通知使用内联形式，不以浮动 toast 飞入后消失。实际页面的人工核验见 [backlog](../backlog.md#通知状态标记人工验收)。

---

## 对话框 `.vibe-dialog`

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

- 遮罩 `--overlay`，面板 0.5px `--line-2`、`--r-md`、`--surface`、**无阴影**。
- 标题 `--f-head` / 600，字号 `--vibe-type-subheading`（16px）；不使用 eyebrow，description 可选，仅在影响决策时提供。
- 页脚 = `.vibe-button--text` 取消 + `.vibe-button--primary` 确认。
- 行为：`Esc` 关闭、遮罩内焦点循环、打开时把焦点移入、关闭后归还原元素、锁定 body 滚动。
- 记账、编辑与历史导入设置 `dirty`：未修改时直接关闭，修改后由同一弹窗确认放弃；取消按钮通过 `actions(requestClose)` 使用相同保护。放弃提示只描述关闭后丢弃当前输入，不据此断言服务端是否保存。继续编辑保留输入，保存成功直接关闭。设置 `pending` 时阻止 Esc、遮罩及重复提交，操作按钮由调用者同步禁用。
- 放弃或切换确认保留原表单实例，以 `hidden` / `inert` 暂停原表单的显示与交互，保留草稿和字段校验状态；确认操作与保存表单使用独立控件，连续点击或按键连发不能跨过确认视图触发下一阶段动作，新一次操作仍可执行。继续编辑恢复原控件焦点，无需字段 ID。业务切换通过 `confirmation` 提供标题、说明、操作及 `onCancel`，沿用同一弹窗的焦点和滚动生命周期。
- 移动端（≤639px）遮罩贴底、面板 `max-height: calc(100dvh - 24px)`；来源向导类对话框升为全屏，页头页脚吸顶。

## 快捷命令

实现入口为 [CommandMenu](../../src/ui/command-menu.tsx)，结果复用共享按钮配方。

- 搜索采用组合框与列表框语义，输入焦点通过 `aria-activedescendant` 关联活动命令；方向键循环选择，`Enter` 执行，输入法组词期间不执行命令或关闭面板。
- 活动项按命令 ID 跟踪，前序命令增减不改变选择；搜索变化或活动命令移除时回到首项，无结果时清除活动关联。活动项滚动进入可视区，使用共享按钮的黑白反转选中态，长名称自然换行。
- 面板高度受可用视口约束，搜索与关闭入口保持可见，结果区独立滚动；窄屏沿用贴底布局。
- 命令结果不逐项进入 Tab 顺序，Tab 在搜索与关闭按钮间循环；关闭或执行刷新后归还实际打开面板的元素，页面跳转与锁定由相应流程接管焦点。无匹配命令单独播报，不将整份结果列表设为 live region。

---

## 下拉菜单 `.vibe-menu`

复用 [VibeMenu](../../src/ui/vibe/vibe-menu.tsx)。触发器用 `.vibe-button--text` + `.vibe-menu__trigger`（紧凑高 40px）。面板 `--surface` + `--line-2` + `--r-sm`，`z-index: 30`。

- 悬停底色 `--raised`，**不是强调色**。
- 危险项 `--vibe-menu__item--danger` 用 `--accent-text` 作为**前景色**，不是红底白字。
- 键盘：`ArrowDown/Up` 循环、`Home/End` 首尾、`Esc` 关闭并归还焦点、失焦即关闭。

## 提示 · `.vibe-tooltip`

复用 [VibeTooltip](../../src/ui/vibe/vibe-tooltip.tsx)，提示不承载完成操作所必需的唯一信息。

- 默认向下、水平居中；`align="end"` 靠右对齐，`side="right"` 优先向右显示。
- 两种方向共用 React 管理的显示状态与 Portal 定位；挂到最近的模态弹窗或 body，`z-index: 120`。空间不足时换向并保持在视口内，长文和连续字符自然换行；触发器、内容尺寸或文案变化后重新测量。
- 鼠标可跨过间隔移入提示正文，停留期间保持可见；离开触发器与提示且触发器未聚焦时关闭。`Esc` 只关闭当前提示并保留焦点，滚动或缩放也关闭；重新移入或聚焦后可再次显示，不由 CSS 悬停规则重新打开。
- 内容用 `--f-mono` `--vibe-type-label`（12px），底色 `--raised`，`--r-sm`。
- 实际触发器必须带 `aria-describedby` 指向提示节点，并保留已有说明。自定义触发组件通过 `VibeTooltipTriggerProps` 将关联传给内部按钮或链接，不把关联停留在外层布局容器；提示不加入 Tab 顺序，业务 Portal 接管焦点时关闭原按钮提示。

## 验证码分格输入 · `.vibe-verification-code`

- 6 个 40×50px 槽位，用 Doto 承载数字；真实 `<input>` 透明覆盖其上，保证原生输入与无障碍。
- 复用 [VibeVerificationCode](../../src/ui/vibe/vibe-verification-code.tsx)，输入保留数字键盘与 `autocomplete="one-time-code"`；视觉槽位不重复进入读屏。
- 默认由控件管理输入，也可通过 `value` / `onValueChange` 交由调用方管理；两种模式都过滤非数字并限制长度，真实输入与视觉槽位共用同一值。需要跨弹窗关闭保留的草稿归流程组件持有，控件不持久化验证码。
- 聚焦时当前槽边框转 `--primary`；`aria-invalid="true"` 时全部转 `--error`（绝不用"抖动"表达错误）。
- 宽度不足 360px 时槽位收窄到 36px。

## 日期字段 · `.vibe-date-field`

- 触发器 48px 高、`--r-sm`、Doto 数字、正常字距。
- 日历：`--surface` + `--line-2` + `--r-md`，日期用 Doto，**今天 = 反转填充**，已选 = `--display` 描边。“今天”按上海当前自然日判断，与可选日期上限分开。
- 服务于"按上海自然日保存"的手工记录。日历本身不写入任何数据。
- 面板在视口四周留 12px，宽高受视口约束，内容超高时内部滚动；七列日期不依赖浏览器默认按钮内边距，窄屏放大文字时月份与操作可换行，不产生横向滚动。
- 复用 [VibeDateField](../../src/ui/vibe/vibe-date-field.tsx)，展开后聚焦可选的已选日期，依次回退到所在月的今天或首个可选日期；已有日期超出范围时落在最近的可选边界。日期区只保留一个 Tab 停靠点，方向键按日或周移动，`Home` / `End` 到周首尾，`PageUp` / `PageDown` 换月，配合 `Shift` 换年；跨月保留目标日，月末不足时取该月最后一天，均受日期范围限制。导航不改变已选值，`Enter` / `Space` 才确认。
- 月切换与清空可通过键盘到达，月份变化礼貌播报；`Esc` 收起并归还焦点，`Tab` 离开日历边界后沿原字段顺序继续；今天与已选状态可被读屏识别。面板随月份行数、字体与字段尺寸变化重新定位，保持在视口内。

## 数据表 · `.vibe-data-table`

- 表头 `--vibe-type-micro` 等宽大写、`--muted`、下边界 `--line-2`。
- 单元格默认 `--f-mono` `--vibe-type-label`（12px）、下边界 `--line`、数值右对齐、文本左对齐；持仓明细的字号与双行布局遵守 [金融信息与隐私](patterns.md#金融信息与隐私)。
- **无斑马纹。** 需要区分时用更多留白或分组细线。
- 不可读或未估值必须在文案上如实说明（“未估值”／“数据不足”），状态前景可用 `--error`，不以整行色底代替文字。使用表头与单元格语义，窄屏滚动及数值完整性见页面模式。

分页复用 [VibeTablePagination / useTablePagination](../../src/ui/vibe/vibe-table-pagination.tsx)，不在页面重建控件或页码校验；组合行为见 [页面模式](patterns.md#金融信息与隐私)。

## 数据行与预览列表

- `.vibe-data-row`：下边界 `--line`，最后一行自动去掉边界。
- `.vibe-preview-list`：`dt` 用 `--vibe-type-micro` 等宽大写 `--muted`，`dd` 用 `--vibe-type-label`（12px）等宽 `--primary`。用于来源详情的授权摘要——**这里绝不回显凭证原文**，只显示授权范围与校验时间。

## 认证玻璃面 · `.vibe-auth-surface`

`--glass` + `backdrop-filter: blur(16px)`、`--r-md`、**无边框、无阴影**。用于锁定页与预置页的身份验证面板。

## 空态

内容结构为标题、一行说明与必要时的一个主操作；无操作可执行时不放无效按钮。不用插画、emoji 或多行长文案。

当前页面采用上下细线、透明底、无圆角的变体，未采用上游的虚线边框与点阵字形。

## 通用交互与无障碍

- 使用原生按钮、链接与输入语义，Tab 顺序与视觉顺序一致，无键盘陷阱；所有操作均可键盘完成，拖拽提供等价的非拖拽路径。
- 弹窗焦点循环跳过禁用字段（含 `fieldset` 继承的禁用状态）和负 `tabindex` 元素，无可用控件时焦点留在弹窗。
- 日期与下拉字段共用 [禁用联动](../../src/ui/vibe/use-close-on-field-disabled.ts)：原字段因自身或外层 `fieldset` 实际禁用时收起 Portal 弹层，恢复可用后不自动展开；遵循首个 `legend` 的原生例外，迟到交互不能改写值。
- 图标有相邻文字时隐藏装饰语义；纯图标按钮必须有可访问名称。装饰 SVG 使用 `aria-hidden="true"` 与 `focusable="false"`。
- 不使用 `outline: none` 移除焦点而没有同等可见的替代。按钮焦点用 0.5px `--primary` 轮廓、外偏移 3px；菜单项用 0.5px 内轮廓，下拉选项用 0.5px 内轮廓；字段沿用聚焦配方。
- 命中区按 [基础规范](foundations.md#7-控件尺寸) 执行，触控目标之间至少留出 8px；不让轻薄轮廓缩小实际可点范围。
- 异步状态保留清楚的可见标签，按需增加读屏播报，不重复制造可见提示。错误不用抖动表达。
- 新组件先查现有组合；分段条、复选行和内联通知可继续承担已有场景。只有真实需求无法满足时才新增，并遵守同一 Token、语义与交互合同。

## 来源接入与刷新反馈

来源类型是进入配置的按钮列表，不使用一经选择就跳页的单选框。配置与确认保留只读权限、公开地址和真实预览；不重复说明“确认后保存”。

刷新失败或部分失败后，原按钮提供“重试刷新”；原因直接可见，整体刷新提供“检查资产来源”。部分失败使用 warning，不把全部数据标成错误。错误区域可换行并使用 status/alert，不能只藏在 title 中。
