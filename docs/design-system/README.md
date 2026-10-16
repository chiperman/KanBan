# Personal Asset Dashboard · 设计规范系统

本目录是 KanBan（Personal Asset Dashboard）的**完整设计规范**。它由规范文档集与一份**可运行的样式指南**组成，两者都以仓库真实运行时源码为唯一事实来源。

- 打开 **`styleguide.html`** 可以在浏览器中看到每个 token、字形与组件的真实渲染结果，并实时切换明暗主题。
- 阅读本目录的 Markdown 可以了解规则、边界、契约与治理流程。

---

## 1. 如何使用

| 你的角色 | 从这里开始 |
|---|---|
| 要写或改界面 | [`01-foundations.md`](01-foundations.md) → [`03-components.md`](03-components.md) → [`04-patterns.md`](04-patterns.md) |
| 要做设计评审 | [`styleguide.html`](styleguide.html) → [`06-governance.md`](06-governance.md) 的交付前检查清单 |
| 要新增组件 | [`06-governance.md`](06-governance.md) 的变更流程，并先查 [`07-deviation-register.md`](07-deviation-register.md) 是否已有历史包袱 |
| 要处理无障碍或响应式 | [`05-accessibility.md`](05-accessibility.md) |
| 要审计视觉一致性 | [`07-deviation-register.md`](07-deviation-register.md) |

权威顺序：**`DESIGN.md`（采用契约）→ 本目录（规范展开）→ `styleguide.html`（渲染证据）**。任何冲突以 `DESIGN.md` 为准，并应回到本目录修正不一致之处。

---

## 2. 单一事实来源

规范里没有一行是手写的视觉值。样式指南由脚本从下列源文件读取后注入：

| 内容 | 来源 |
|---|---|
| 运行时 token、字体加载、明暗两套值 | `src/app/design-tokens.css` |
| 组件视觉配方 | `src/app/vibe-components.css` |
| 线形 SVG 图标集 | `src/ui/vibe/vibe-icon.tsx` |
| 9×9 点阵字形比特 | `src/ui/vibe/vibe-dot-icon.tsx` |
| 产品布局与交互适配 | `src/app/product-layout.css` |
| React 组件接口 | `src/ui/vibe/*.tsx` |

上游视觉契约固定在 [`wangbh030722/vibe-nothing-ui-design@46661e5`](https://github.com/wangbh030722/vibe-nothing-ui-design/commit/46661e55ae04537215a229be49f2ac1bd37a4255)，本目录不对其做 vendoring。上游 `main` 的任何后续变化都不自动生效，更新程序见 [`06-governance.md`](06-governance.md)。

---

## 3. 分层模型

系统分为三层，职责不可互相渗透：

```
① 上游契约层   tokens → 颜色 / 字体角色 / 圆角 / 缓动        （语义来源）
② 组件配方层   src/app/vibe-components.css                   （可复用配方）
③ 产品适配层   src/app/product-layout.css + src/ui/         （布局与业务）
```

- 第 ① 层是唯一的视觉语义来源。产品不得改写 token 值，也不得为某一页引入第三套主题。
- 第 ② 层只组合 token，不引入新语义。
- 第 ③ 层可以承载布局、密度与业务表达，但**不得新造视觉语言**：它引用的颜色、字体角色、圆角、缓动都必须来自第 ① 层。

`src/app/globals.css` 是设计系统建立之前的遗留层（见 [`07-deviation-register.md`](07-deviation-register.md)），**新代码不得在其中新增样式**。

---

## 4. 重新生成样式指南

```bash
pnpm design:styleguide
```

产物：

- `docs/design-system/styleguide.html` — 自包含单文件（字体以 data URI 内嵌），可直接双击打开或离线分发
- `docs/design-system/tokens.json` — 机器可读的 token 导出，供交接与工具链消费

生成器为 `scripts/build-styleguide.mjs`，内容模板为 `scripts/design-system/styleguide-sections.mjs`。若源文件结构发生破坏性变化，生成器会直接报错而不是产出静默错误的页面。

### 4.1 验收样式指南

```bash
pnpm design:styleguide:verify
```

在真实 Chromium 中打开生成物，逐项断言：6 个 `@font-face` 全部加载、Doto / Geist / Geist Mono / Newsreader 四个字族真实解析、零 `box-shadow`、卡片圆角 8px、点场为 `difference` 混合且间距 `120px 120px`、明暗两套 `--bg` 与 token 一致、对话框开关、下拉菜单、验证码槽位同步、计数动画落位到目标值、390px 视口无横向溢出、控制台与页面均无错误。截图落在 `tmp/styleguide-verify/`（已被 git 忽略）。

验收脚本为 `scripts/verify-styleguide.mjs`。**它断言的是渲染结果，不是源码文本**——因此能捕捉到生成器与真实浏览器之间的偏差。改了生成器或模板后请重跑一次。

### 4.2 守门：不让偏差继续变大

```bash
pnpm design:lint   # 已接入 pnpm test，改动 CSS 后会随开发门禁自动运行
```

扫描 `src/app/*.css` 与 `src/ui/**/*.{ts,tsx}`，按 9 条机械规则判定违反视觉契约的裸值：

| 规则 | 判定 | 应改为 |
|---|---|---|
| `raw-hex` | 出现 `#rgb` / `#rrggbb` | 语义 token（`design-tokens.css` 的定义处豁免） |
| `raw-color-fn` | 出现 `rgb()` / `hsl()` / `oklch()` | 同上 |
| `raw-font-stack` | `font-family:` 不含 `var()` | `var(--f-display\|ui\|mono\|head\|editorial)` |
| `px-radius` | `border-radius` 带 px | `var(--r-sm\|md\|pill)` |
| `offscale-font-size` | 字号不命中 `--vibe-type-*` | 级差表内的 token（SVG 用户坐标系按设计豁免） |
| `offscale-breakpoint` | 不是 0 / 640 / 1024 / 1200 的写法 | 四档断点 |
| `box-shadow` | 出现 `box-shadow`（`none` 除外） | 细线 + z-index |
| `important` | 出现 `!important` | 提高选择器特异性 |
| `undefined-design-token` | `var(--x)` 找不到任何定义处 | 改用已定义的 token，或补上定义 |

**存量走基线豁免，新增直接失败。** 基线是 `scripts/design-system/token-lint-baseline.json`，按 `<规则>|<文件>|<规范化声明文本>` 的内容签名记录，不含行号——因此挪动或重排代码不会误报，只有真正多出来一处才会拦下。当前基线 90 处。修掉存量后重建基线：

```bash
pnpm design:lint -- --update
```

字号刻度是**现读** `src/app/design-tokens.css` 的 `--vibe-type-*`，所以新增一档 token 后不需要改脚本。全部存量的编号与说明见 [`07-deviation-register.md`](07-deviation-register.md)。

**按设计豁免写进规则，不写进基线。** 例如 SVG 用户坐标系里的字号（`SVG_TEXT_SELECTORS`）不是欠账，因此不占基线条目——基线只该记录待偿还的存量，否则会退化成"什么都允许"的清单。

`undefined-design-token` 是回报最高的一条：它跨文件比对引用与定义，能抓出浏览器**静默丢弃声明**这类靠读代码几乎发现不了的问题。第一次运行就抓出 11 处（见 D-21）。

---

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| [`01-foundations.md`](01-foundations.md) | 色彩、字体排版、间距、圆角、层次、动效 |
| [`02-dot-matrix-and-background.md`](02-dot-matrix-and-background.md) | 点阵语言与背景点场 |
| [`03-components.md`](03-components.md) | 组件契约、状态、可访问性、使用边界 |
| [`04-patterns.md`](04-patterns.md) | 页面模式、金融真值表达、状态机、响应式 |
| [`05-accessibility.md`](05-accessibility.md) | WCAG AA 底线、焦点、命中区、减弱动效、中文排版 |
| [`06-governance.md`](06-governance.md) | 变更流程、组件缺口、交付前检查清单 |
| [`07-deviation-register.md`](07-deviation-register.md) | 已核验的现有偏差登记表 |

---

## 6. 一句话原则

> 像一件精密仪器：黑白为底，信息优先，强调色只点亮唯一最重要的那件事。

当某处没有被规范覆盖时，按这句话判断：**安静、精确、信息优先。**
