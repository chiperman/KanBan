# 07 · 偏差登记表

本表登记仓库中**与设计契约不一致**的已知事实。它只登记，不改动产品代码——每一项整改都需要独立任务与独立验收。

---

## 0. 核定方法

本表的"判定"不是代码阅读推断，而是**按真实加载顺序挂载真实 CSS 后读取计算样式**得到的：探针页依次引入 `globals.css` → `design-tokens.css` → `command-menu.css` → `product-layout.css` → `vibe-components.css`（与 `src/app/layout.tsx` 的导入顺序一致），再对目标选择器读取 `getComputedStyle`，明暗两套主题各测一次。因此每条都区分了**生效值**与**被覆盖的死代码**。

**如果你想复现**：在 `tmp/` 下建一个 HTML 按上述顺序 `<link>` 这五个文件，放入目标元素，用浏览器读计算样式即可。切勿直接凭源码里的声明下结论——本仓库里大量声明是被后续文件覆盖的。

**其中机械可判定的部分已经固化为脚本**：`pnpm design:lint`（`scripts/lint-design-tokens.mjs`）按 10 条规则扫描 `src/app/*.css` 与 `src/**/*.{ts,tsx}`，出现基线之外的新增即失败；存量基线在 `scripts/design-system/token-lint-baseline.json`，按内容签名而非行号记录，因此重排代码不会误报。

守门规则与本表的对应关系：

| 守门规则 | 覆盖本表 | 基线处数 |
|---|---|---|
| `raw-hex` | D-01、D-02、D-09 | 5 |
| `raw-color-fn` | D-10 | 1 |
| `raw-font-stack` | D-04 | 12 |
| `px-radius` | D-05、D-06、D-17 | 17 |
| `offscale-font-size` | D-18 | **0**（存量已清空；2 处 SVG 用户坐标按设计豁免，写在脚本的 `SVG_TEXT_SELECTORS` 里） |
| `offscale-breakpoint` | D-11 | 19 |
| `box-shadow` | D-08 | 6 |
| `important` | D-19 | 16 |
| `undefined-design-token` | D-21 | **0**（存量已清空） |
| `page-button-override` | D-22 | **0**（认证页与首次供给页豁免） |

以下条目**无法机械判定**，只能靠评审与探针：D-03（语义冲突）、D-07（渐变机制）、D-12（卡片材质分级）、D-13（死代码）、D-14（token 与 `DESIGN.md` 表述冲突）、D-15（空态配方）、D-16（减弱动效规则缺失）。

**脚本只覆盖 src/app/*.css 与 src/ui/**/*.{ts,tsx}**。`src/**` 下其他目录（如服务端代码）只参与 `undefined-design-token` 的引用扫描，不参与裸值扫描——那些文件不承载视觉契约。

---

## 1. 总览

| 编号 | 现象 | 判定 | 视觉影响 |
|---|---|---|---|
| D-01 | 暗色下 6 个选择器原解析为 `#e08a7a`（token 之外） | **已整改** | — |
| D-02 | `.total-status.incomplete/expired` 原告警色 `#a64722` | **已整改** | — |
| D-03 | `.asset-sync-error` 明暗语义冲突（暗 `#e08a7a` / 亮 `--secondary`） | **已整改** | — |
| D-04 | 硬编码字体栈未用 Geist Mono（原 17 处：2 处生效、15 处死代码） | **已整改（2 处生效已修复）** | — |
| D-05 | `.editor-dialog` 圆角 16px（上限 8px，死代码） | **已整改** | — |
| D-06 | `.session-locked` 圆角原 10px（上限 8px） | **已整改** | — |
| D-07 | 已隐藏走势占位用半透明 surface 叠网格线（原失效渐变） | **已整改** | — |
| D-08 | `box-shadow` 的 6 处使用 | 1 处死代码 / 3 处状态 / 2 处焦点下划线 | 低 |
| D-09 | 硬编码 `#ffffff`/`#fff`（①改 token ②遮罩例外） | **已整改 / 例外** | — |
| D-10 | 点场配方中的 `rgba()` 裸值 | **生效**（与上游一致） | 无 |
| D-11 | 断点未收敛（9 档） | **生效** | 中 |
| D-12 | 卡片材质三种处理共存 | **生效** | 高 |
| D-13 | 死代码（18 个无 TSX 引用的选择器族） | **已整改** | — |
| D-14 | `--vibe-space-0` = 2px 不属 4px 刻度 | **生效**（且与 `DESIGN.md` 表述冲突） | 低 |
| D-15 | 空态实现与上游配方不一致 | **生效** | 中 |
| D-16 | `globals.css` 无减弱动效规则 | **生效** | 低 |
| D-17 | 硬编码 `border-radius` px 值（20 处） | 多数不生效，1 处生效 | 低 |
| D-18 | 字号未收敛到级差表（微标签 40 处 + 其余表外 36 处） | **已整改**（另 2 处按设计豁免） | — |
| D-19 | 16 处 `!important` 集中在 `product-layout.css` | 生效（用途分三类） | 低 |
| D-21 | 10 处 `var(--dur, 0.2s)` / `var(--r-technical)` 引用未定义 token | **已整改** | 低（但属静默失效） |
| D-22 | 按钮实现分散在共享组件、页面类名和页面 CSS 覆盖三层 | **已整改** | 高 |

---

## 2. 详细条目

### D-01 · 暗色主题下出现 token 之外的红色

- **位置**：`src/app/globals.css:339`、`:553`、`:916`
- **现象**：暗色主题下，`.danger-button`（裸用）、`.login-error`、`.asset-sync-status.expired`、`.asset-sync-error`、`.total-status.incomplete`、`.total-status.expired` 全部解析为 `rgb(224, 138, 122)` = `#e08a7a` —— 这个值**不属于任何一套主题 token 集**。
- **根因**：`[data-theme="dark"] X` 的特异性为 (0,2,0)，高于 `src/app/product-layout.css:3628–3634` 中 token 化的 `X { color: var(--accent-text) }` (0,1,0)，因此后者在暗色下失效。
- **对照实证**：同一主题下 `.content-error`（无暗色覆盖）解析为 `rgb(255, 68, 56)` = `--accent-text`。也就是说**同屏两个"错误红"来自两个不同来源**。
- **同一族的第三个值（不生效）**：`globals.css:335`、`:344`、`:912` 写的是亮色版的 `#b3402e`。探针实测 `.danger-button` 与 `.content-error` 在亮色下都解析为 `rgb(194, 20, 28)` = `#c2141c` = 亮色 `--accent-text`，因此这三处**从未渲染**——它们被 `product-layout.css:3628–3634` 的同特异性后序规则覆盖。登记在案，删除时随 D-13 一起走。
- **影响**：对比度不受 token 契约保证；明暗两套主题的"危险红"视觉不一致。
- **建议**：删除 `globals.css` 中的三处暗色 hex 覆盖，统一由 `var(--accent-text)` 承担。
- **整改（已执行）**：删除了 `globals.css` 中全部暗色 `#e08a7a` 覆盖（`.danger-button`、`.login-error` 的 `[data-theme="dark"]` 块，以及 `.asset-sync-status.expired` / `.asset-sync-error` / `.total-status.incomplete` / `.total-status.expired` 的暗色块），改由 `product-layout.css` 已有的 `var(--accent-text)` 规则统一接管。明亮下 `.danger-button` / `.login-error` 的 `#b3402e` 为永不渲染的死代码，按"只登记不擅自改"纪律保留至 D-13 清理。

### D-02 · 亮色主题下 `.total-status` 告警色为 `#a64722`

- **位置**：`src/app/globals.css:507`、`:542`
- **实测**：亮色下 `.total-status.incomplete` / `.expired` → `rgb(166, 71, 34)`
- **影响**：与同屏其它次级警示色（`--accent-text` `#c2141c`）不一致，且不在 token 集内。
- **建议**：改用 `--warning` 或 `--accent-text`，并明确该状态的语义归属。
- **整改（已执行）**：`globals.css` 中 `.total-status.incomplete/expired` 与 `.asset-sync-status.expired, .asset-sync-error` 两处 `#a64722` 改为 `var(--accent-text)`，与危险/信号红统一。未引入新语义拆分；若日后要区分"过期/告警"与"错误"两级，再评估改用 `--warning`。

### D-03 · `.asset-sync-error` 在明暗主题下语义不同

- **实测**：暗色 → `rgb(224, 138, 122)`（D-01）；亮色 → `rgb(88, 90, 90)` = `--secondary`
- **根因**：亮色下由 `src/app/product-layout.css:5171–5178`（`.asset-sync-error { color: var(--secondary) }`）覆盖了同文件 `:3629` 的 `var(--accent-text)`；暗色下则被 D-01 的 globals 规则抢先。
- **影响**：同一个"同步错误"元素在亮色下退化为次级灰，不再是错误色。状态标签的文字与圆点仍在，因此未构成信息丢失，但两块 CSS 的意图明显冲突。
- **建议**：确定 `.asset-sync-error` 的最终语义，删掉冲突的一方。
- **整改（已执行）**：在 `product-layout.css` 的分组 `.asset-sync-error { color: var(--secondary) }` 之后补一条 `.asset-sync-error { color: var(--accent-text); }`（仅覆盖颜色，保留该分组的字号/字栈）。结合 D-01 删除暗色 `#e08a7a` 覆盖后，`.asset-sync-error` 在明暗两套主题下均解析为 `--accent-text`，成为真正的错误红。

### D-04 · 两处硬编码字体栈实际生效

- **生效（已修复）**：`src/app/globals.css` 的 `.source-status` 与 `.holding-symbol` 原解析为 `ui-monospace, "SF Mono", Menlo, Consolas, monospace`（缺 Geist Mono），已改为 `var(--f-mono)`。
- **已失效**：其余 11 处（`globals.css:19` `body`、`54`、`75`、`242`、`456`、`486`、`501`、`527`、`585`、`596`、`627`、`795`）被 `product-layout.css:3611` 组的 `var(--f-mono)` 与产品 `body` 字体覆盖，实测解析为 token 栈
- **同类的第三组（不生效，探针补测）**：`command-menu.css:22`（`.command-menu-trigger kbd`）、`:60`（`.command-menu-empty`）、`:127`（`.command-menu-item small`）。`product-layout.css:3611` 的选择器清单**不含** `.command-menu-*`，故此前无法凭源码判断；探针实测三者均解析为 `"Geist Mono", "SF Mono", ui-monospace, monospace`，即被 `product-layout.css:3752` / `:3760` 与 `vibe-components.css:1356` 覆盖。**不生效**，随 D-13 一并清理。
- **合计**：全仓库 17 处硬编码字体栈 —— 现已 0 处生效（2 处已修复为 `var(--f-mono)`）、15 处为不生效死代码（基线豁免，随 D-13 清理）
- **影响**：仅那 2 处的数字与相邻等宽文本字形不一致（不加载 Geist Mono）。
- **建议**：改为 `var(--f-mono)`；不生效的 15 处随死代码清理。
- **整改（已执行）**：`.source-status` 与 `.holding-symbol` 两处生效的硬编码栈已改为 `var(--f-mono)`，与相邻等宽文本统一为 Geist Mono。守门基线 raw-font-stack 由 17 降到 15（剩余 15 处均为被覆盖的死代码，归 D-13）。

### D-05 · `.editor-dialog` 圆角 16px

- **位置**：`src/app/product-layout.css:5503–5508`（`.editor-dialog, .command-menu-panel { border-radius: 16px }`）
- **实测**：`.editor-dialog` → `16px`（覆盖了 `:1968` 的 `var(--r-md)` 与 `command-menu.css:42` 的 `10px`）
- **补充**：`.editor-dialog` / `.editor-overlay` 在 `src/` 中**无 TSX 引用**，属死代码；`.command-menu-panel` 的真实元素始终带 `data-vibe-surface="command-panel"`，被 `vibe-components.css:1311` 拉回 `var(--r-md)` = 8px，因此 16px 对它不生效。
- **建议**：随死代码一并删除。
- **整改（已执行）**：`.editor-dialog` 与 `.editor-overlay` 整条规则（含 `globals.css` 与 `product-layout.css` 中的定义）已删除；混合规则 `.editor-dialog, .command-menu-panel { border-radius: 16px }` 仅摘除 `.editor-dialog`，保留活着的 `.command-menu-panel`（其 16px 仍被 `vibe-components.css` 覆盖为 8px，属 Tier-2 残留）。

### D-06 · `.session-locked` 圆角 10px

- **位置**：`src/app/globals.css`（`.session-locked` 块，无后续覆盖，实测 10px）
- **影响**：超出 8px 上限，且与卡片语言不一致。
- **建议**：改为 `var(--r-md)`。
- **整改（已执行）**：`border-radius: 10px` → `var(--r-md)`（8px）。`product-layout.css` 的同名规则未设 radius，故 10px 确为生效值；改后圆角收敛到 8px 上限。守门基线 px-radius 由 21 降到 20（globals 中剩余 7 处 `border-radius: 10px` 均为被覆盖的死代码，归 D-13）。

### D-07 · 已隐藏走势占位用半透明 surface 叠网格线

- **位置**：`src/app/product-layout.css`（`.asset-trend-private`，约 4674 行）
- **实测（整改前）**：原写法 `linear-gradient(var(--surface), var(--surface)) padding-box, repeating-linear-gradient(...)` 上层为**不透明**实色 `--surface`，把下层网格线完全盖住，实际渲染为纯实色面板——**网格线从未显示**，属失效写法。
- **判定**：`--surface` 在本系统为不透明实色（暗 `#0c0c0c` / 亮 `#ffffff`，见 `design-tokens.css:64/88`），双层渐变在现有 token 下无法露出网格线；同时它不触发任何机械守门规则（用的是 `--surface`/`--line` token，无裸 hex / 圆角 / 阴影 / `!important`），归"无法机械判定"一类。
- **整改（已执行）**：将上层改为 `linear-gradient(color-mix(in srgb, var(--surface) 62%, transparent), …) padding-box`，使半透明 surface 压在 `repeating-linear-gradient`（每 20% 一根 `var(--line)` 竖线）之上，网格线得以显示，成为"已隐藏走势"的遮罩质感。全程使用 `--surface`/`--line` token，明暗主题自动解析；`color-mix` 不触发 `raw-color-fn`（`rgba(`）守门规则，基线仍为 76 处不变。代码内已加注释标注此为 D-07 有意效果、非装饰渐变。
- **复核**：`pnpm design:lint` 通过（新增 0 处）；沙箱无 chromium，未跑真实浏览器回归，但机制已按 token 推导确认网格线可见（预览页原位于 `tmp/d07-preview.html`，现见[本地临时证据归档说明](../audits/README.md#本地临时证据)）。

### D-08 · `box-shadow` 的六处使用

| 位置 | 声明 | 判定 |
|---|---|---|
| `command-menu.css:44` | `0 18px 60px color-mix(...)` | **死代码**，实测计算值为 `none`（被 `vibe-components.css:1311` 覆盖） |
| `product-layout.css:3342`、`:3355`、`:7616` | `0 4px … , 0 8px …` | 拖拽手柄在 hover / `:focus-visible` / `.card-resizing` 状态下用堆叠偏移阴影绘制"堆叠短杠" |
| `product-layout.css:1382`、`:6739` | `inset 0 -2px var(--display)` | 焦点下划线，属边框替代 |

- **建议**：删除 `command-menu.css:44`；其余改用边界或背景实现，或按"边框替代例外"显式登记（参照上游允许的 `0 0 0 2px` 头像环）。

### D-09 · 硬编码十六进制色（两处，分两类）

- **① `src/app/product-layout.css` `::selection { color: #ffffff }`** —— 选中高亮的文字色，背景是 `--accent`(#d71921 红)。
  - **整改（已执行）**：改为 `var(--accent-ink)`（设计系统已有该 token，明暗均为 `#ffffff`）。既去掉裸 hex，又保持明暗都是白字红底（用户偏好，且对比度合格）；若用 `var(--display)` 会在亮色退化为黑字红底（对比度略好但观感次之），故用 `--accent-ink`。
- **② `src/app/product-layout.css` `.locked-flow-route-reveal { stroke: #fff }`** —— 这是 `owner-login.tsx` 里 `<mask>` 的 **luminance 亮度值**（white=显示 / black=隐藏），不是可见描边。
  - **判定**：改 `var(--display)` 会让亮色主题变为黑色 → 遮罩隐藏 → 路线揭示动画在亮色下消失。**必须保持 `#fff`**。
  - **处置（已执行）**：保留 `#fff`，加注释标注为 D-09 有意例外（遮罩亮度值，非颜色）；登记册标"已登记例外"。裸 hex 仍计入基线，归为已知契约外例外。

### D-10 · 点场配方中的 rgba 裸值

- **位置**：`src/app/vibe-components.css:842`（`body::before` 的 `rgba(255, 255, 255, 0.42)`）
- **判定**：与上游点场配方逐字一致，属契约内实现；但令牌层无法统一调参。
- **建议**：若上游未提供对应 token，保持现状并在注释中标注为契约外例外（本页 02 文档已记录该配方）。

### D-11 · 断点未收敛

- **实测**：`max-width` 媒体查询共 41 次（`product-layout.css` 33、`globals.css` 4、`vibe-components.css` 3、`command-menu.css` 1），去重后 9 档：`359 / 639 / 640 / 720 / 959 / 1023 / 1199 / 1359 / 1439`
- **另有**区间查询：`(min-width:720px) and (max-width:1023px)`、`(min-width:640px) and (max-width:1199px)`
- **规范**只承认 **0 / 640 / 1024 / 1200** 四档
- **影响**：视觉节奏在不同宽度上不可预测，验收难以穷尽。
- **建议**：新增样式只用四档；存量在独立任务中收敛，每收敛一档跑一次响应式回归。

### D-12 · 卡片材质三种处理共存

| 选择器 | 位置 | 实测材质 |
|---|---|---|
| `.card` | `product-layout.css:4396` | `1px solid var(--line)` 边框 + `--surface` 实底；`:hover { transform: none }` 显式关闭抬升 |
| `.total-overview-card` | `product-layout.css:4406` | 无边框 + `--glass` + `blur(16px)` |
| `.card.vibe-data-card` | `vibe-components.css:880` | 无边框 + `--glass` + `blur(12px)`，**无 TSX 引用** |
| `.asset-source-card` | `product-layout.css:6450` / `:6456` | 总览中透明无边框；来源详情页转为无边框玻璃 |

- **上游契约**：卡片是"无边框磨砂玻璃，`--r-md`，悬停 `translateY(-2px)`"。
- **影响**：与契约不一致；`.card` 的悬停抬升被显式禁用（`transform: none`），也就是说上游的悬停语言在本产品里不成立。
- **建议**：明确本产品的卡片分级（透明模块 / 玻璃面板 / 带边框容器），把结论写回 [`03-components.md`](03-components.md)，并据此决定 `.card` 的边框与悬停行为。

### D-13 · 死代码

在 `src/` 中**无任何 TSX 引用**的选择器：

- `.vibe-data-card` / `.card.vibe-data-card` / `.card.vibe-data-card::after` / `.total-overview-card.vibe-data-card`（`vibe-components.css:880`、`:910`、`:924`）
- `.editor-dialog` / `.editor-overlay`（`globals.css:347–368`、`product-layout.css:5503–5519`）
- `.markdown-body` 及其子选择器（`globals.css:216–243`）
- `.card-drag-measurement` / `.card-drag-measurement > .card-actions`（`globals.css:896–908`）
- `.layout-span-control`（`globals.css:291–310`）
- **核对 D-18 时新确认的一批**（按"类名是否出现在任何 `.tsx` 中"判定）：

  | 选择器 | 位置 | 备注 |
  |---|---|---|
  | `.identity-name` | `globals.css:210`、`product-layout.css:1942`、`:1954` | 两处字号声明同值，互为重复 |
  | `.header-sub` | `globals.css:63`、`product-layout.css:1873`、`:3908` | |
  | `.layout-mode-status` | `globals.css:274` | |
  | `.source-preview-title` | `globals.css:431`、`product-layout.css:1945` | 注意 `asset-source-flow.tsx` 里的 `source-flow-preview-title` 是 **id**，不是这个类 |
  | `.login-copy` | `globals.css:906`、`product-layout.css:4027`、`:5977`、`:8012` | |
  | `.restricted-title` | `globals.css` / `product-layout.css:1947`、`:3725` | |
  | `.login-instrument-state` | `product-layout.css:5999` | |
  | `.total-overview-amount` | `globals.css:484`、`product-layout.css:3574`、`:6045`、`:7499` | 「总览金额」这个产品最重要的数字，其选择器已不在标记里 |
  | `.today-change-amount` | `globals.css:594`、`product-layout.css:3575`、`:3601`、`:3607`、`:5028` | |
  | `.text-button` | `globals.css:266`、`product-layout.css:4098` | |
  | `.card-actions` | `globals.css:896`、`product-layout.css:6949` | |
  | `.asset-trend-yesterday` 系列 | `product-layout.css:4676+` | 未被删除，但引用了未定义的 `--vibe-type-display-sm`（见 D-21） |

  这批合计承载了 D-18 中 14 处字号声明。它们**不产生视觉影响**，因此 D-18 的整改只做 token 化、不做删除；真正清理时随本条目一起走。判定方法：把 `src/**/*.tsx` 里的全部标识符收集成集合，再逐个选择器查其类名是否在集合中。**注意这只覆盖静态类名**，动态拼出来的类名（如 `` `login-${state}` ``）会误判——本仓库目前没有这种写法，但下次核对时需先确认。

被覆盖而永不生效的声明：

- `command-menu.css:42`（`10px` 圆角）、`:44`（阴影）
- `globals.css:46`、`:157`、`:252`、`:366`、`:867`、`:895`、`:976` 等处的 `10px` 圆角
- 15 处硬编码字体栈（全仓库 17 处里的不生效部分）：`globals.css` 的 12 处——`:19`（`body`，`-apple-system` 栈）、`:54`、`:75`、`:242`、`:456`、`:486`、`:501`、`:527`、`:585`、`:596`、`:627`、`:795`；`command-menu.css` 的 3 处——`:22`、`:60`、`:127`（见 D-04）
- 3 处硬编码 hex `#b3402e`：`globals.css:335`、`:344`、`:912`（见 D-01）

- **建议**：按文件分批删除，每批跑一次浏览器回归。删除优先级最高——风险最低且直接降低后续维护成本。删完后重建守门脚本基线。
- **整改（已执行）**：用深度感知的 CSS 转换器（跳过 `@media`、字符串、`:not()`，对含死类的选择器只摘死留活）一次性删除全部 18 个死选择器族的规则——`globals.css` 18 删 / 4 改、`product-layout.css` 42 删 / 25 改、`vibe-components.css` 4 删 / 1 改。删除前逐类名在 `src/**/*.{tsx,ts}` 复核零引用（含动态类名排查：`locked-flow-source--N`、`asset-sync-status ${status}` 等动态类均不在死名单内）。守门基线由 82 降到 76 处（`raw-font-stack` 15→12、`px-radius` 20→17）。**Tier-2 残留（死声明挂在活选择器上，被覆盖、无视觉影响，仍在基线）**：`globals.css` 的 `#b3402e`×3、`command-menu.css` 的 3 处死字体栈与 `:44` 死阴影、`globals.css` 剩余的 `border-radius: 10px`×7 等——这些属于"声明级"清理，可后续单独收尾。删除为纯静态删除，沙箱无 chromium，未跑浏览器回归，但 `tsc --noEmit` 与 `pnpm design:lint` 均通过。
- **附：删除清单（18 族）**：vibe-data-card、editor-dialog、editor-overlay、markdown-body、card-drag-measurement、layout-span-control、identity-name、header-sub、layout-mode-status、source-preview-title、login-copy、restricted-title、login-instrument-state、total-overview-amount、today-change-amount、text-button、card-actions、asset-trend-yesterday。

### D-14 · `--vibe-space-0` 不属 4px 刻度

- **位置**：`src/app/design-tokens.css:131`，值 `2px`
- **冲突**：`DESIGN.md` 第 2 节声明 `--vibe-*` token "仅限已记录的 4px 布局/字号刻度"。同样不属该范畴的还有 `--vibe-control-height-compact`（40px）、`--vibe-duration-fast` / `--vibe-duration-theme`（时间值）。
- **影响**：token 层自身与契约表述不一致，后续读规范的人会得出错误结论。
- **建议**：二选一 —— 修订 `DESIGN.md` 的表述以覆盖这三组 token（推荐，因为控制尺寸与时长本就不该强行归入 4px 刻度），或把 2px 改为 4px。

### D-15 · 空态实现与上游配方不一致

- **位置**：`src/app/product-layout.css:5349–5355`
- **实测**：`border-radius: 0px`、`background: transparent`、上下各一条 1px `--line` 细线
- **覆盖关系**：`globals.css:863–870` 的虚线边框 + `10px` 圆角 + `--raised` 底被完全覆盖
- **上游配方**：虚线边框 + 9×9 点阵字形 + `--f-head` 标题 + 一行说明 + 一个主按钮
- **建议**：确定采用哪一种。若采用上游配方，应把它组件化（当前仍是散落的产品样式）。

### D-16 · `globals.css` 无减弱动效规则

- **实测**：`prefers-reduced-motion` 出现次数 —— `product-layout.css` 7、`vibe-components.css` 1、`command-menu.css` 1、`globals.css` **0**
- **影响**：该文件中若存在过渡或动画，不会响应减弱动效偏好。
- **建议**：随死代码清理一并处理。

### D-17 · 硬编码 `border-radius` px 值

| 文件 | 处数 | 值 | 判定 |
|---|---|---|---|
| `globals.css` | 15 | `10px` × 8、`999px` × 3、`4px`、`6px` × 2、`8px` | 多数被覆盖 |
| `command-menu.css` | 4 | `999px`、`10px`、`6px` × 2 | 多数被覆盖 |
| `vibe-components.css:92` | 1 | `2px`（日历图标） | **生效** |

- **建议**：存量随死代码清理；`vibe-components.css:92` 的 2px 用于构造日历图标内部的小圆角，作为例外登记即可。

### D-18 · 字号未收敛到级差表 — **已整改（76 处）**

- **核定**：在 `src/app/*.css` 中扫描全部 `font-size: <N>px` 字面量，与 `--vibe-type-*` 的取值集合比对。两个子类的根因是同一个——**级差表比产品实际在用的字号序列少档**。
- **判据（先定规则，再逐条套）**：
  1. **补档** —— 同一取值在 ≥2 处承担同一角色，或它是某个语义族（如"展示数字"）的成员。级差表缺的是这一档，不是代码写错。
  2. **吸附** —— 只出现 1 处、或与相邻档位相差 ≤2px，属"再调一点更好看"推出来的值，并入最近的既有档。
- **总数**：低于下限 11px 的微标签 40 处（18a）+ 其余表外取值 36 处（18b/18c）= **76 处**；另 2 处按设计豁免。

#### 18a · 微标签（低于下限 11px）— **已整改，40 处**

| 文件 | 处数 | 原行号 |
|---|---|---|
| `product-layout.css` | 28 | 687, 1829, 1842, 1852, 1901, 3498, 3683, 3979, 4036, 4179, 4217, 4364, 4476, 4506, 4526, 5054, 5303, 6630, 6815, 6863, 7591, 8144, 8221, 8597, 8614, 8669, 9368, 9740 |
| `vibe-components.css` | 8 | 18, 181, 723, 1010, 1082, 1112, 1269, 1359 |
| `globals.css` | 3 | 675, 778, 830 |
| `command-menu.css` | 3 | 23, 72, 128 |

- **取值分布**：`8px` ×1、`9px` ×13、`10px` ×28
- **共同角色**：几乎全部是"等宽大写微标签"——`--f-mono` + `letter-spacing: .08–.14em`。例如 `.vibe-field__label`、`.vibe-dialog__eyebrow`、`.vibe-data-table th`、`.vibe-preview-list dt`、`.command-menu-item.vibe-button small`
- **性质**：这是**系统性**偏差，不是零散失误。级差表下限是 11px，但产品把这一角色稳定地用到了 9–10px，也就是说**级差表缺一档**
- **整改（已执行）**：新增 `--vibe-type-micro: 10px`（在 `design-tokens.css` 注释中写明其唯一角色与来源），把 **40 处** UI 字面量替换为该 token，取值由 9px / 10px 收敛到 10px。

#### 18b / 18c · 其余表外取值 — **已整改，36 处**

| 值 | 处数 | 判定 | 目标 token | 理由 |
|---|---|---|---|---|
| `13px` | 19 | **补档** | 新增 `--vibe-type-body-xs` | 产品的 `body` 本身就是 13px。级差表最低到 11px，等于**规范解释不了产品自己的正文** |
| `20px` | 5 | **补档** | 新增 `--vibe-type-title` | 该 token 早被 `.trend-interval-change > strong` 等处引用却从未定义（见 D-21）；且 `.locked-clock > strong` 在窄屏正好用 20px |
| `26px` | 1 | **补档** | 新增 `--vibe-type-display-sm` | 同上，被 `.asset-trend-yesterday > strong` 引用却未定义；26 落在 `heading`(24) 与 `display-md`(36) 之间，补上它展示族才有最小一档 |
| `17px` | 3 | 吸附 | `--vibe-type-body`（16） | 输入控件档。`.source-management-dialog .vibe-field__input` 早就把它覆盖成 `var(--vibe-type-body)`——组件层与产品层不一致，以产品层为准 |
| `19px` | 1 | 吸附 | `--vibe-type-subheading`（18） | 差 1px。`.restricted-title` 同为标题却已用 18px |
| `22px` | 2 | 吸附 | `--vibe-type-title`（20） | 差 2px。两者都是"仪表数字"（锁定时钟、验证码格），与 `title` 同族；吸附后窄屏那处 20px 覆盖不再需要 |
| `15px` | 1 | 吸附 | `--vibe-type-body`（16） | 差 1px，且该选择器已死（见 D-13） |
| `42px` | 1 | 吸附 | `--vibe-type-display-md`（36） | 是 `display-lg`(48) 在窄屏的降级，宁可保住"移动端更小"的意图 |
| `44px` | 1 | 吸附 | `--vibe-type-display-lg`（48） | 差 4px |
| `52px` | 1 | 吸附 | `--vibe-type-display-lg`（48） | 差 4px |
| `68px` | 1 | 吸附 | `--vibe-type-display-xl`（72） | 差 4px |

- **执行方式**：逐行精确替换的 codemod（`tmp/tokenize-scale.mjs`），替换前校验每一行的值符合预期，不符即中止。`git diff` 对照备份确认**恰好 36 处，无附带改动**。
- **整改后仍存在的一处不一致（未处理，需设计决策）**：`.vibe-field__input` 现为 `--vibe-type-body`（16px），而 `.vibe-select .vibe-select__trigger` 为 `--vibe-type-body-xs`（13px）——**同一个表单家庭里两个控件相差 3px**。本次的判定依据是"以产品层为准"：`.source-management-dialog .vibe-field__input` 早就把组件层覆盖成了 16px，所以把组件层的 17px 吸附到 16px 是消除冲突；但下拉触发器这一侧没有产品层覆盖，13px 就是它的最终值。两者是否应统一，属于控件字号族的决策，不在本次范围内。
- **未纳入本次**：`src/ui/asset-trend-chart.tsx` 的 4 处 `fontSize: 10`（recharts 轴刻度）。`10px` 现在命中 `--vibe-type-micro`，因此不再算表外；但它们仍是未 token 化的字面量，且 React 内联样式传数字而非 CSS 变量，改法需先确认 recharts 走 `style` 还是 SVG 表现属性（后者不接受 `var()`）。

#### 豁免 2 处（SVG 用户坐标系）

`product-layout.css` 的 `.locked-flow-screen text`（9px）与 `.locked-flow-dashboard-label`（8px `!important`）。二者位于 `owner-login.tsx` 的 `<svg>` 内部（`.locked-flow-screen` 是 `<g>` 元素），其 `px` 是**图纸单位**而非排版字号，会随 `viewBox` 缩放，级差表对其不适用。**按设计豁免，不是欠账**——因此写进守门脚本的 `SVG_TEXT_SELECTORS`，不占基线条目。

#### 遗留：选择器已死

上述 36 处里有 14 处的选择器**在当前 TSX 中不存在**（`.identity-name`、`.header-sub`、`.layout-mode-status`、`.source-preview-title`、`.login-copy`、`.restricted-title`、`.login-instrument-state`、`.total-overview-amount`、`.today-change-amount`、`.text-button`、`.card-actions`）。它们不产生视觉影响，本次只做了 token 化，没有删除。详见 D-13。

### D-21 · 9 处 `var(--dur, 0.2s)` 与 1 处 `var(--r-technical)` 引用了从未定义的 token — **已整改**

- **位置**：`vibe-components.css:37`、`:252`、`:339`、`:340`、`:370`、`:479`、`:559`、`:560`、`:561` 与 `globals.css:716`（`--dur`）；`product-layout.css:2522`（`--r-technical`）
- **现象**：两个 token 在 `design-tokens.css` 里都不存在。但两种引用的后果不同——
  - `var(--dur, 0.2s)` **带了回退值**，所以 `transition` 照常生效，回退值 `0.2s` 等于把 `--vibe-duration-fast: 200ms` 这个 token 的取值硬编码进了 fallback；
  - `var(--r-technical)` **没有回退值**，于是 `border-radius` 整条被浏览器丢弃，`.asset-source-flow__steps li` 的圆角一直是 0。
- **性质**：这是**靠读代码最难发现**的一类问题——不报错、不留痕，元素悄悄退回继承值或 fallback。
- **根因**：没有规则比对"引用"与"定义"。`pnpm design:lint` 原本只扫裸值，`var(--x)` 看起来完全合规，因此一路通过。
- **整改（已执行）**：10 处 `var(--dur, 0.2s)` → `var(--vibe-duration-fast)`；1 处 `var(--r-technical)` → `var(--r-sm)`（该芯片是等宽大写小标签，属控件圆角）。
- **配套规则**：`pnpm design:lint` 新增 `undefined-design-token`，跨文件比对 `var(--x)` 引用与定义（定义可来自 CSS 的 `--x:`、TSX 内联样式对象、或 `setProperty`），并区分"无回退（声明被丢弃）"与"有回退（token 形同虚设）"两种情形。加上这条之后，`offscale-font-size` 与 `undefined-design-token` 两条在基线上都是 0。

### D-19 · 16 处 `!important` 全部集中在 `product-layout.css`

- **核定**：`!important` 全仓库出现 16 次，**全部**在 `src/app/product-layout.css`；其余四个样式表为 0

| 位置 | 声明 | 用途分类 |
|---|---|---|
| `:3833`、`:3834`、`:3835` | `animation-duration` / `animation-iteration-count` / `transition-duration` | **合理**：`prefers-reduced-motion` 的全局硬关闭，必须压过所有前置声明 |
| `:7980` | `.login-pixel.is-filled { animation: none }` | **合理**：同类，同一媒体查询内 |
| `:8114`、`:8119`、`:8123`、`:8124`、`:8129`、`:8181`、`:8186`、`:8226` | `.locked-flow-*` 的 `fill` / `stroke` | **可疑（10 处）**：SVG 绘制属性被逐个硬压，说明此处与某条继承规则或全局 SVG 规则存在冲突，用 `!important` 绕过而非消除 |
| `:4745`、`:4747` | `.trend-interval-label` 的 `color` / `font-size` | **可疑（2 处）**：该选择器在仓库中只有这一处声明，没有可见的竞争规则，`!important` 的承重对象不明 |

- **附带的刻度违规**：`:8221` `font-size: 8px !important` 是全仓库唯一低于 9px 的字号（见 D-18）；`:8222` `letter-spacing: 0.12em !important` 与字号一起硬压
- **判定**：第一类（4 处）是标准手法，建议在本表标注为**允许的例外**；后两类（12 处）需要针对性探针确认承重对象后再决定删除或重构
- **建议**：先只做分类登记，不改动。`.locked-flow-*` 属于 SVG 绘制层，改动风险不在视觉而在动画渲染，应随一次聚焦的浏览器验收一起做

---

## 3. 处理优先级

1. **保持守门脚本常绿（已就位）**——`pnpm design:lint` 把 10 条机械规则锁住，68 处存量走基线豁免，新增即失败。这是唯一一条**已经生效**的闸门，其余各项都在它的保护下慢慢还。新增的 `undefined-design-token` 规则第一次运行就抓出了 D-21 那 11 处静默失效的声明。
2. **删除死代码**（D-13，以及 D-05、D-08 中的死代码项；探针新确认的 15 处不生效字体栈、3 处不生效 hex，以及承载了 14 处字号声明的 11 个已死选择器，一并纳入）——零视觉风险，直接降低维护成本。
3. **统一冲突语义**（D-01、D-02、D-03）——有视觉影响但范围可控，需要一次聚焦的视觉验收。
4. **分类并清理 `!important`**（D-19）——先确认 12 处可疑项的承重对象，再决定删除或重构。
5. **统一卡片与空态语言**（D-12、D-15）——影响面最大，需要先在设计层决策，再实施。
6. **逐条替换裸值**（D-04、D-06、D-07、D-09、D-16、D-17）——收尾工作。**每修掉一处就重建一次基线**（`pnpm design:lint -- --update`），否则存量数字会虚高。

每一项整改完成后，请更新本表对应条目的判定列，并在提交信息中引用编号。

### D-22 · 按钮语言分散在组件、页面类名和页面 CSS 三层 — **已整改**

- **位置**：`command-menu.tsx`、`logout-button.tsx`、`recovery-setup.tsx`、`theme-switcher.tsx`、`asset-source-detail.tsx`、`market-benchmark-controls.tsx`、`holding-candlestick-chart.tsx`、`source-investment-performance.tsx`，以及 `globals.css`、`command-menu.css`、`product-layout.css` 中的按钮选择器。
- **现象**：同一页面里既有 `VibeButton`，也有手写按钮类名；页面 CSS 还会在组件层之上覆盖背景、文字色、边框、圆角、字号、内边距和透明度，造成刷新、记账、危险操作、周期切换等按钮视觉不一致。暗色和亮色下的激活态尤其容易随加载顺序漂移。
- **整改（已执行）**：React 按钮统一收敛到 `VibeButton` / `VibeLink` 的 `variant` + `size` + `shape` + `tone` 封闭属性；删除页面类名中的视觉意图；页面级按钮 CSS 只保留放置、伸缩、间距和响应式显隐。危险操作保留描边并交给 `tone="danger"`，不使用红色填充。
- **豁免**：登录页与首次供给页的既有按钮不纳入本次统一；其页面选择器显式写在守门豁免里。
- **配套规则**：`pnpm design:lint` 新增 `page-button-override`。按钮选择器命中视觉属性时直接失败；`display`、尺寸、定位、间距、伸缩、响应式显隐等布局属性仍允许页面层处理。
