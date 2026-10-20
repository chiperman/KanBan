# KanBan 设计契约

黑白为底，信息优先，强调色只用于真实信号。本文是设计规范的唯一入口，规定上游采用范围、项目适配与维护方式。

## 阅读与效力

| 文档 | 负责内容 |
| --- | --- |
| 本文 | 采用契约、上游版本、源码归属、变更与验证 |
| [基础规范](docs/design-system/foundations.md) | Token、字体、间距、圆角、动效、点阵与背景 |
| [组件规范](docs/design-system/components.md) | React 接口、组件配方、状态、键盘与焦点 |
| [页面模式](docs/design-system/patterns.md) | 页面布局、响应式、金融信息呈现与页面验收 |

本文与主题规范定义应遵守的设计合同，运行时 Token 和组件源码是实现入口。冲突时先核对本文的适配规则和实际运行路径；尚未落实的差异统一记入 [backlog](docs/backlog.md)。

业务语义、安全与财务口径以 [CONTEXT](CONTEXT.md) 和 [有效 ADR](docs/adr/README.md) 为准；页面职责与实现入口见 [当前能力与源码导航](docs/current-baseline.md)。各项规则只在所属文档维护一份，历史整改和验收记录从 Git 查询。

## 固定上游参考

外部视觉参考为 [Vibe-Nothing-UI](https://github.com/wangbh030722/vibe-nothing-ui-design)，采用版本固定为 [`46661e55ae04537215a229be49f2ac1bd37a4255`](https://github.com/wangbh030722/vibe-nothing-ui-design/commit/46661e55ae04537215a229be49f2ac1bd37a4255)。

日常开发以本文、主题规范与本地源码为准。升级上游，或遇到本地规范未覆盖的设计问题时，再按需核对固定版本的：

1. [SPEC.md](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/SPEC.md)：上游视觉规则。
2. [index.html](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/index.html)：组件与组合样例。
3. [DESIGN.md](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/DESIGN.md)：设计理由、Token 与决策。

配方参考同版本的 [tokens.css](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/css/tokens.css) 与 [nothing-ui.css](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/css/nothing-ui.css)。上游 `main` 的变化不自动生效；需要核对但无法在线读取时，明确说明未完成核对。

## 项目适配

- **禁止彩色左侧状态边条。用圆点或小色块标记状态，并配合明确文字。** 此规则覆盖上游通知的彩色左边条配方，适用于通知、卡片和列表等界面；普通结构性分隔线不属于状态边条。
- 复用上游的颜色、字体角色、圆角与状态语义；不引入第二套主题、CSS 框架、reset 或字体体系。
- `--vibe-*` 用于本项目已定义的字号、间距、控件尺寸和时长。间距以 4px 为基准，允许已有的 2px 微调；字号按角色取档，不要求为 4px 倍数。不借这些前缀重定义颜色、字体角色、圆角或状态。
- 中文字体回退、金融数值与敏感信息、交互命中区及减弱动效的适配分别在三份主题规范中维护。安全、隐私、无障碍、财务真值和只读约束优先于上游样例。
- 组件先复用与组合，出现真实场景再新增；上游有而本产品未使用的组件不自动成为待办。
- 上游 JavaScript 仅供参考，本地交互由 React 实现；不完整复制或 vendoring 上游仓库。字体仅使用 [本地开源字体及其 OFL 许可证](public/fonts/nothing-open/)，不从非官方镜像获取或再分发专有字体。第三方声明见 [notices](docs/third-party-notices.md)。

## 源码归属

| 入口 | 职责 |
| --- | --- |
| [design-tokens.css](src/app/design-tokens.css) | 运行时 Token、明暗主题与字体加载 |
| [vibe-components.css](src/app/vibe-components.css) | 可复用组件视觉配方 |
| [src/ui/vibe/](src/ui/vibe/) | 产品页面消费的 React 接口 |
| [product-layout.css](src/app/product-layout.css) | 产品布局、密度与交互适配 |
| [globals.css](src/app/globals.css) | 遗留层；新样式不写入此处 |
| [layout.tsx](src/app/layout.tsx) | 样式加载顺序与全局装配 |

页面不得重建组件配方。共享按钮的放置、尺寸、间距、伸缩和响应式显隐由页面负责；颜色、背景、边框、圆角、排版、内边距、阴影、透明度及过渡由组件层负责，接口见 [组件规范](docs/design-system/components.md#按钮与名称链接)。

## 变更与验证

变更先定位所属规范与实际调用者，再同步修改合同和实现。保留合同的内部重构无需为改文档而改文档；新差异只在 backlog 维护，完成后移除。文档更新本身不证明界面已符合规范。

| 改动范围 | 验证要求 |
| --- | --- |
| 仅文档 | 检查引用、锚点、术语与差异范围；不因此运行构建、业务测试或浏览器 |
| 运行时样式、Token 或组件配方 | 运行 `pnpm design:lint`，按影响范围补充类型检查或既有相关单测 |
| 交互或页面布局 | 按 [测试纪律](AGENTS.md#测试纪律) 确定验证范围；需要页面验收时，直接检查受影响页面，判据见 [页面模式](docs/design-system/patterns.md#页面验收) |

`pnpm test` 可执行完整的类型检查、设计守门与离线单测。页面检查不能替代真实来源或账户数据验收。

[design:lint](scripts/lint-design-tokens.mjs) 守门颜色、字体、圆角、字号、断点、阴影、`!important`、未定义 Token 与共享按钮覆盖。存量由 [基线](scripts/design-system/token-lint-baseline.json) 记录，新增违反项直接失败。基线不是设计批准，不许先更新基线绕过检查；修复后核对差异再收紧。新增字号只能定义 `--vibe-type-*`，不向脚本添加白名单；SVG 图纸单位等既有例外见基础规范。

## 更新上游版本

更新固定版本时，比较新旧 commit 的规范、样例、Token、配方和许可证，更新本文固定链接，并按受影响范围验证本地实现。提交获授权后，在提交正文记录旧、新引用版本和实际验证；不能顺带跟随 `main` 更新。
