# 基础规范：视觉、字体与点阵

运行时以 [design-tokens.css](../../src/app/design-tokens.css) 为入口；采用范围与验证见 [设计契约](../../DESIGN.md)。页面复用语义 Token，不另写颜色或字号。

## 1. 色彩

统一使用 `@radix-ui/colors` 3.0.0 的官方色阶。主界面跟随浅色、深色与系统偏好；介绍页使用同版深色阶并在本地分发。根节点 `.dark` 与 `data-theme` 同步，避免语义色与底色主题不一致。

按 [Radix 色阶用途](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) 分配颜色：1–2 为画布和表面，3–5 为交互底色，6–8 为分隔与边界，9–10 为实色填充，11–12 为文字与图标。不以自定义混色替代官方色阶。

| Token | Radix 色阶 | 用途 |
| --- | --- | --- |
| `--bg` | Gray 1 | 页面画布 |
| `--surface`、`--glass` | Gray 2 | 面板、菜单与对话框 |
| `--raised` | Gray 3 | 悬停、次级表面 |
| `--display` | 浅色 Black Alpha 12，深色 White Alpha 12 | 关键数字、主操作与按钮选中底色；操作和选中态搭配反色文字 |
| `--line`、`--glass-brd` | Gray 6 | 结构分隔 |
| `--line-2` | Gray 8 | 控件轮廓 |
| `--secondary`、`--muted` | Gray 11 | 次级文字、日期、刻度 |
| `--primary` | Gray 12 | 正文、标题、焦点 |
| `--accent` | Red 9 | 必要的信号填充 |
| `--accent-text`、`--error` | Red 11 | 危险操作和错误文字 |
| `--success` | Green 11 | 成功、连接状态 |
| `--warning` | Amber 11 | 部分失败、待处理 |
| `--benchmark-spx`、`--benchmark-ndx` | Blue 11、Amber 11 | 标普 500、纳斯达克 100 分类色 |
| 通知底色 | Red 3、Green 3、Gray 3 | 错误、成功、一般通知 |
| `--overlay` | Black Alpha 8 | 模态遮罩 |
| `--accent-ink`、`--mask-ink` | White Alpha 12 | 红底文字、SVG 亮度遮罩 |

颜色只增强已有含义；状态必须有文字或图标，不整行染色，不用彩色左边条。常规操作保持中性。市场分类色与涨跌语义分开，曲线同时通过图例与线型区分。便携 SVG 图标使用官方深色 Gray 1/12 与 Red 9 的 sRGB 值。

`--black`、`--dark-grey`、`--grey`、`--light-grey`、`--white` 为兼容别名，新代码使用语义 Token。

## 2. 字体排版

字号最多四档，最小 12px。优先用字重、间距和对齐组织层级，不添加新字号。输入保持 16px，避免手机聚焦缩放。

| 大小 | Token 角色 | 用途 |
| --- | --- | --- |
| 24px | `heading` 与全部 `display-*` | 页标题、关键金额 |
| 16px | `subheading`、`title`、`body` | 小节标题、输入和正文 |
| 14px | `body-sm`、`body-xs` | 常规内容、列表 |
| 12px | `caption`、`label`、`micro` | 时间、单位、标签、短状态 |

上述角色均使用 `--vibe-type-*`，兼容名称只是别名，不是更多档位。独立介绍页的 `--type-*` 使用相同四档。

| 角色 | Token | 字体 |
| --- | --- | --- |
| 数字 | `--f-display` | Doto |
| 界面 | `--f-ui` | Geist，中文回退 PingFang SC、Noto Sans SC、系统字体 |
| 数据和代码 | `--f-mono` | Geist Mono |
| 标题 | `--f-head` | Geist |
| 历史兼容 | `--f-editorial` | Newsreader，不新增标语 |

金融数字使用 `tabular-nums`；表格和列表数值右对齐，摘要指标的标签与读数起点对齐，单位保持紧邻。Doto 保留 `font-variation-settings: "ROND" 100`，常规读数使用 500，首页总资产使用 700 强调主次。中文不使用西文大写样式和过宽字距。图示文字同样使用已有字号角色。

## 3. 间距

以 4px 为基准，使用 `--vibe-space-*`：4、8、12、16、20、24、32、40、48、64、96px，2px 仅用于光学微调。同组紧凑、分组留白；先调整布局与间距，再考虑分隔线。对齐控件外缘、文字基线和数据列，不为长短不一的内容制造等高空白。

## 4. 圆角

| Token | 值 | 用途 |
| --- | --- | --- |
| `--r-sm` | 4px | 控件和内层面板 |
| `--r-md` | 8px | 对话框和必要的独立表面 |
| `--r-pill` | 999px | 圆点、头像和特定区间控件 |

页面分区优先直角与留白，不把每组信息包装成卡片。嵌套圆角按“外半径减去内边距”处理；内边距超过外半径时内层可直角。禁止彩色左边条、装饰性阴影和无用途的胶囊。

## 5. 层次

边框、分隔线与焦点轮廓统一 **0.5px**。焦点通过高对比颜色及外偏移保持可辨识，不增加阴影。功能图标与数据曲线的描边按可读性保留，不当作容器边框。

层次由留白、边界和表面色表达，不依赖投影。菜单、对话框、固定导航保留原有层级和遮挡关系；图形绘制用的几何阴影不作为卡片投影推广。

## 6. 动效

默认静态显示。取消页面入场、金额滚动、图表重绘、主题颜色过渡与登录装饰循环。只有反馈确有必要时才添加过渡，基准为 **250ms / ease-out**，通过 `--vibe-duration-fast` 和 `--ease` 引用。

刷新中的旋转仅表示操作仍在进行，同时显示状态文字。`prefers-reduced-motion: reduce` 下停止非必要运动，状态立即落位。禁用控件保持可读，不用极低透明度隐藏操作。

## 7. 控件尺寸

标准交互目标至少 44px，紧凑目标至少 40px；字段默认至少 48px。使用 `--vibe-control-height`、`--vibe-control-height-compact` 和 `--vibe-control-padding-inline`。轮廓更小时通过布局保留命中范围。键盘与焦点见 [组件规范](components.md#通用交互与无障碍)。

## 8. 点阵语言

Doto 数字与百分号保持同一单元，字母单位使用等宽字体。金融数据不为点阵效果牺牲精度或可读性。[VibeDotIcon](../../src/ui/vibe/vibe-dot-icon.tsx) 继续使用完整圆点；[VibeIcon](../../src/ui/vibe/vibe-icon.tsx) 使用单色功能图标。

装饰图不能编码真实金额、来源身份或授权状态。SVG 亮度遮罩用 `--mask-ink`，不能随主题反转。

## 9. 背景点场

页面不再添加装饰性点场或渐变。走势图点阵由用户显示偏好控制；隐藏金额时的网格仅表示隐私遮挡，不暗示真实走势。

## 10. 对比度

普通文字至少 4.5:1，24px 大字至少 3:1。必要的图形和焦点至少 3:1；状态不只依靠颜色。使用官方色阶不替代实际明暗主题、不同表面及缩放检查。
