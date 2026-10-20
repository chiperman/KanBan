/**
 * Content for the generated design system styleguide.
 *
 * Every token value, glyph and component recipe rendered by this module is
 * supplied by the caller after being read from the repository's real runtime
 * sources. This file only owns editorial content: token roles, grouping,
 * specimen composition, and Chinese product-domain copy.
 *
 * Do not hardcode token values, colour literals, font stacks or glyph bitmaps
 * here — pass them in through `context` instead.
 */

const BADGE_NOTE = "规范目标 · 尚未组件化";

/* ------------------------------------------------------------------ */
/* Token roles and grouping                                            */
/* ------------------------------------------------------------------ */

export const COLOR_GROUPS = [
  {
    id: "canvas",
    label: "画布与表面",
    note: "层级来自 1px 细线与留白，不来自阴影。玻璃面是无边框材质，不是阴影。",
    tokens: [
      { name: "--bg", role: "页面画布（暗色为 OLED 黑，亮色为暖灰纸）" },
      { name: "--surface", role: "菜单、弹层、对话框底色" },
      { name: "--raised", role: "次级抬升、悬停行、缩略图与键帽填充" },
      { name: "--overlay", role: "模态遮罩（--bg 或 --surface 的透明混合版）" },
      { name: "--glass", role: "玻璃卡填充，必须与 backdrop-filter 成对使用" },
      { name: "--glass-brd", role: "玻璃卡可选的内侧 1px 细线，不是卡边框" },
    ],
  },
  {
    id: "text",
    label: "文本层级",
    note: "层级由字号跳变与字重承担，不靠颜色堆叠。正文用柔白／柔黑，不用纯 #FFF/#000。",
    tokens: [
      { name: "--display", role: "标题、主数字、反转填充" },
      { name: "--primary", role: "正文文字与默认图标色" },
      { name: "--secondary", role: "标签、次级说明文本" },
      { name: "--muted", role: "最弱文字、占位符、刻度" },
    ],
  },
  {
    id: "lines",
    label: "线条",
    note: "细线恒为 1px。列表／表格内部用 --line，控件轮廓用 --line-2。",
    tokens: [
      { name: "--line", role: "列表、表格、分区之间的分隔细线" },
      { name: "--line-2", role: "控件轮廓、可见边框、分段条空槽" },
    ],
  },
  {
    id: "signal",
    label: "信号",
    note: "强调色只表达信号，绝不做装饰。典型一屏 0–2 个红色元素；控件激活态一律黑白反转，不用红。",
    tokens: [
      { name: "--accent", role: "信号红填充（需要决策、越限、录制／实时点、通知角标）" },
      { name: "--accent-text", role: "强调色作为前景（文字／边框／图标），暗色提亮、亮色压深以保对比" },
      { name: "--accent-ink", role: "红底之上的文字色" },
      { name: "--restricted-dot", role: "受限内容的点阵纹理，不承载金额语义" },
      { name: "--dotbg", role: "上游遗留 token，当前点场不使用（见背景点场章节）" },
    ],
  },
  {
    id: "status",
    label: "数据状态",
    note: "状态色只落在数值本身，不落在标签或整行背景上。亮色主题下三种状态色都会压深。",
    tokens: [
      { name: "--success", role: "数据状态：正常／已连接／已刷新" },
      { name: "--warning", role: "数据状态：注意／待确认" },
      { name: "--error", role: "数据状态：错误。与强调色同属一个红色家族" },
    ],
  },
  {
    id: "legacy",
    label: "兼容别名",
    note: "上游早期命名的中性色别名，仅供历史样式引用；新代码不得使用，语义请改用 above 的分层 token。",
    tokens: [
      { name: "--black", role: "兼容别名，等价于纯黑" },
      { name: "--dark-grey", role: "兼容别名，等价于 --raised" },
      { name: "--grey", role: "兼容别名，中间灰" },
      { name: "--light-grey", role: "兼容别名，等价于 --muted" },
      { name: "--white", role: "兼容别名，等价于纯白" },
    ],
  },
];

export const TYPE_ROLES = [
  {
    token: "--f-display",
    family: "Doto",
    label: "点阵显示",
    usage: "字标、主数字、独立数字与它们的百分号、时钟、模块编号",
    rule: "字重 ≤500 且 font-variation-settings: 'ROND' 100，保持圆点分离；加粗会让点粘连、曲线顶端出现尖角。",
    sample: "1,234,567.89%",
    sampleClass: "sg-specimen-doto",
  },
  {
    token: "--f-ui",
    family: "Geist",
    label: "界面／正文",
    usage: "正文、说明文字、控件标签的可读承载",
    rule: "中文正文自动回退到 PingFang SC / Noto Sans SC，这是本产品的适配层规则，不改变上游视觉契约。",
    sample: "总资产按当前来源账户总额汇总，未估值项目不计入零。",
    sampleClass: "sg-specimen-ui",
  },
  {
    token: "--f-mono",
    family: "Geist Mono",
    label: "等宽／数据",
    usage: "大写标签（0.08–0.14em 字距）、数据、代码、表格单元格、时间戳",
    rule: "标签一律大写＋扩字距。金融数值使用 tabular-nums 保证跨行对齐。",
    sample: "TOTAL ASSETS · 2026-10-16 17:03 GMT+8",
    sampleClass: "sg-specimen-mono",
  },
  {
    token: "--f-head",
    family: "Geist SemiBold",
    label: "标题",
    usage: "卡片标题、对话框标题、分区标题",
    rule: "组件标题只用这一种字重（600）。不要用多种字重堆叠层级。",
    sample: "区间投资盈亏",
    sampleClass: "sg-specimen-head",
  },
  {
    token: "--f-editorial",
    family: "Newsreader Italic",
    label: "编辑体强调",
    usage: "仅限页面级的一句品牌文案或引语",
    rule: "绝不出现在任何可复用组件内部（按钮、输入、卡片、表格、导航、弹窗、标签、列表、看板磁贴）。一屏至多一句短句。",
    sample: "A quiet instrument for your own capital.",
    sampleClass: "sg-specimen-editorial",
    pageLevelOnly: true,
  },
];

export const SPACING_STEPS = [
  { token: "--vibe-space-0", relation: "—" },
  { token: "--vibe-space-1", relation: "触碰级（图标与文字）" },
  { token: "--vibe-space-2", relation: "同组内" },
  { token: "--vibe-space-3", relation: "同组内上限" },
  { token: "--vibe-space-4", relation: "组件内边距" },
  { token: "--vibe-space-5", relation: "面板内边距" },
  { token: "--vibe-space-6", relation: "模块内边距" },
  { token: "--vibe-space-8", relation: "新分组" },
  { token: "--vibe-space-10", relation: "新分组" },
  { token: "--vibe-space-12", relation: "新语境" },
  { token: "--vibe-space-16", relation: "新语境" },
  { token: "--vibe-space-24", relation: "页面级留白" },
];

export const RADIUS_ITEMS = [
  { token: "--r-sm", usage: "控件、按钮、输入框、标签", note: "上游同值" },
  { token: "--r-md", usage: "卡片、对话框、面板", note: "卡片圆角不得超过此值" },
  { token: "--r-pill", usage: "芯片、开关轨道、头像", note: "大胶囊仅限这些元素" },
];

export const ELEVATION_LAYERS = [
  { value: "10", label: "base", usage: "常规内容层" },
  { value: "30", label: "overlay", usage: "下拉菜单、下拉选项面板" },
  { value: "40", label: "modal", usage: "对话框" },
  { value: "50", label: "header", usage: "吸顶页头" },
  { value: "80–120", label: "floating", usage: "提示浮层与其浮动变体" },
];

export const MOTION_ITEMS = [
  { name: "微交互", value: "200ms · ease-in-out", detail: "控件、边框、透明度变化" },
  { name: "主题切换", value: "350ms · ease-in-out", detail: "仅颜色与背景过渡" },
  { name: "悬停", value: "opacity .8（按钮） / translateY(-2px)（卡片）", detail: "禁止改色、禁止阴影" },
  { name: "按下", value: "opacity .6", detail: "机械、干脆、无回弹" },
  { name: "禁用", value: "opacity .3", detail: "刷新进行中等特殊态可局部放宽至 .68" },
];

export const STATE_MACHINE = [
  { name: "idle", shape: "灰色静态点", tone: "muted", usage: "未开始、空闲" },
  { name: "running", shape: "白色点脉冲", tone: "live", usage: "同步中、刷新中" },
  { name: "needs-input", shape: "信号红点", tone: "signal", usage: "需要决策、需要授权" },
  { name: "done", shape: "实心点", tone: "success", usage: "已完成、已刷新" },
  { name: "error", shape: "描边点", tone: "error", usage: "失败、不可读" },
];

export const BREAKPOINTS = [
  { min: "0", max: "639", label: "移动", behaviour: "单列卡片栅格；控件占满整行；对话框升为全屏面板" },
  { min: "640", max: "1023", label: "平板", behaviour: "卡片栅格两列；span-3 降为 span-2" },
  { min: "1024", max: "1199", label: "桌面", behaviour: "三列卡片栅格并启用侧栏导航" },
  { min: "1200", max: "—", label: "宽屏", behaviour: "完整工作台布局，内容上限 1480px" },
];

export const GAPS = [
  { name: "开关 Switch", upstream: "上游 .switch：ON = 白色轨道 + 背景色旋钮（黑白反转，不用红）", status: "本产品尚无组件，仅有 .vibe-choice 复选" },
  { name: "滑块 Slider", upstream: "上游 .slider：细轨道 + 圆形旋钮，填充与旋钮用 --display", status: "本产品无对应场景，未实现" },
  { name: "仪表 Gauge", upstream: "上游 .gauge：细环 + 刻度环 + 居中 Doto 数字，百分号紧随其后", status: "本产品用分段条替代" },
  { name: "标签页 Tabs / 分页 Pager", upstream: "上游 .tabs 下划线（2px --display）与 .pager 的 Doto 数字", status: "本产品用分段条与图标按钮组合替代" },
  { name: "线性进度 Progress", upstream: "上游 .lp：--display 填充", status: "本产品用分段条替代" },
  { name: "横幅 Banner", upstream: "默认 = 反转填充；.sig 红底白字仅限需要决策的消息", status: "本产品用 .vibe-notice 内联承载" },
  { name: "空态 Empty state", upstream: "虚线边框 + 9×9 点阵字形 + 标题 + 一个主按钮，不用插画", status: "现网实现（product-layout.css:5349）为上下 1px 细线 + 透明底 + 无圆角，与配方不一致；配方尚未组件化" },
  { name: "内联状态 Inline status", upstream: "上游明确不用浮动 toast，改用 [SAVED] / [ERROR: …] 内联文本", status: "本产品已按此执行：状态写入控件内的可见标签" },
];

export const DOS = [
  "所有颜色、间距、圆角、缓动都取自 token，输出零裸值。",
  "控件激活态一律黑白反转（按钮主态、选中芯片、今日日期、当前步骤）。",
  "结构由 1px 细线与留白建立，零阴影、零渐变（点场与点阵纹理除外）。",
  "独立数字与其百分号用 Doto；标题与正文用 Geist；标签与数据用 Geist Mono。",
  "卡片为无边框玻璃材质，圆角 8px，悬停仅 translateY(-2px)。",
  "状态先由形状与标签表达，颜色只作第二层信息。",
  "缺失估值显示为「未估值」，绝不折算为零；真实数据不可用时如实降级。",
  "金额保留完整精度、等宽对齐、显式标注币种。",
];

export const DONTS = [
  "把强调色用在按钮、标签页、链接、滑块或悬停上——那是信号位，不是装饰位。",
  "在任何组件内部使用 Newsreader 斜体。",
  "使用 box-shadow、渐变、骨架屏、浮动 toast、吉祥物插画、emoji 充当 UI。",
  "表格斑马纹、卡片加边框、卡片圆角超过 8px。",
  "把点阵铺在前景内容之上，或用 mask / clip-path 裁切点阵图标。",
  "用多种字重堆叠层级，或把标题写成彩色。",
  "为某一页单独新造一套视觉语言或覆盖 token 值。",
  "把凭证原文、密钥或授权材料回显到界面上。",
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dotGlyphMarkup(rows, size) {
  const cells = rows.join("").split("");
  return `<span aria-hidden="true" class="vibe-dot-icon" style="--vibe-dot-icon-size:${size}px">${cells
    .map((cell) => `<span${cell === "#" ? ' class="is-lit"' : ""}></span>`)
    .join("")}</span>`;
}

function sectionHeader(id, index, eyebrow, title, note) {
  return `<header class="sg-section-head">
        <p class="sg-eyebrow">${esc(eyebrow)}</p>
        <h2 class="sg-title" id="${esc(id)}"><span class="sg-index">${esc(index)}</span>${esc(title)}</h2>
        ${note ? `<p class="sg-note">${note}</p>` : ""}
      </header>`;
}

function specimen(title, body, meta = {}) {
  const badges = [];
  if (meta.goal) badges.push(`<span class="sg-badge sg-badge--goal">${BADGE_NOTE}</span>`);
  if (meta.scaffold) badges.push(`<span class="sg-badge sg-badge--scaffold">样式指南脚手架</span>`);
  return `<article class="sg-panel">
        <div class="sg-panel-head">
          <h3 class="sg-panel-title">${esc(title)}</h3>
          ${badges.join("")}
        </div>
        ${meta.rule ? `<p class="sg-rule">${meta.rule}</p>` : ""}
        <div class="sg-stage">${body}</div>
      </article>`;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function renderOverview(ctx) {
  const { meta } = ctx;
  return `<section class="sg-section">
      ${sectionHeader(
        "sg-overview",
        "00",
        "Overview",
        "这份页面如何生成",
        "它不是手写样例集。页面上每一个 token、字形与组件配方都从仓库运行时源文件读取后注入，因此样式指南与产品不可能漂移。",
      )}
      <div class="sg-grid sg-grid--2">
        ${specimen(
          "单一事实来源",
          `<dl class="sg-kv">
            <div><dt>token</dt><dd><code>${esc(meta.tokensSource)}</code></dd></div>
            <div><dt>组件配方</dt><dd><code>${esc(meta.recipeSource)}</code></dd></div>
            <div><dt>线形图标</dt><dd><code>${esc(meta.iconSource)}</code></dd></div>
            <div><dt>点阵字形</dt><dd><code>${esc(meta.glyphSource)}</code></dd></div>
            <div><dt>上游引用</dt><dd><code>${esc(meta.upstream)}</code></dd></div>
            <div><dt>重新生成</dt><dd><code>pnpm design:styleguide</code></dd></div>
            <div><dt>浏览器验收</dt><dd><code>pnpm design:styleguide:verify</code></dd></div>
            <div><dt>裸值守门</dt><dd><code>pnpm design:lint</code>（已接入 <code>pnpm test</code>）</dd></div>
          </dl>`,
        )}
        ${specimen(
          "主题",
          `<p class="sg-body">契约只有两套主题：<code>data-theme="dark"</code> 与 <code>data-theme="light"</code>。不存在第三套，也不允许按页面覆盖 token 值。右上角的切换会改写 <code>&lt;html&gt;</code> 上的属性，因此下文中所有色块都会实时重算。</p>
           <p class="sg-body">产品工作台永远保持暗色（见 <code>[data-sg-pin="dark"]</code> 区域），这样强调色在控制台内始终是同一个红。</p>`,
        )}
      </div>
    </section>`;
}

function renderColor(ctx) {
  const { tokens } = ctx;
  const swatch = (name) =>
    `<span class="sg-swatch" style="background: var(${esc(name)})" aria-hidden="true"></span>`;

  const groups = COLOR_GROUPS.map((group) => {
    const rows = group.tokens
      .map((token) => {
        const dark = tokens.dark[token.name];
        const light = tokens.light[token.name] ?? "—";
        const same = dark === light;
        return `<tr>
              <td class="sg-cell-token">${swatch(token.name)}<code>${esc(token.name)}</code></td>
              <td class="sg-cell-value"><code>${esc(dark ?? "—")}</code></td>
              <td class="sg-cell-value"><code>${same ? `<span class="sg-same">同暗色</span>` : esc(light)}</code></td>
              <td class="sg-cell-role">${esc(token.role)}</td>
            </tr>`;
      })
      .join("");
    return `<article class="sg-panel sg-panel--wide">
        <div class="sg-panel-head"><h3 class="sg-panel-title">${esc(group.label)}</h3></div>
        <p class="sg-rule">${esc(group.note)}</p>
        <table class="sg-table">
          <thead><tr><th>token</th><th>暗色</th><th>亮色</th><th>用途</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </article>`;
  }).join("");

  const greyBudget = specimen(
    "每屏灰色 ≤4 种",
    `<div class="sg-row sg-row--baseline">
          <span class="sg-grey-sample sg-grey-sample--1"></span>
          <span class="sg-grey-sample sg-grey-sample--2"></span>
          <span class="sg-grey-sample sg-grey-sample--3"></span>
          <span class="sg-grey-sample sg-grey-sample--4"></span>
          <code class="sg-code-inline">--display / --primary / --secondary / --muted</code>
        </div>
        <p class="sg-body">灰色本身就承担层级。再叠加第五种灰，层级就变成了噪声。</p>`,
  );

  const signalBudget = specimen(
    "强调色预算：一屏 0–2 个",
    `<div class="sg-grid sg-grid--2">
          <div class="sg-example sg-example--do">
            <p class="sg-example-label">正确 · 红色是信号</p>
            <div class="sg-row">
              <span class="vibe-status-tag vibe-status-tag--signal"><i aria-hidden="true"></i>需要授权</span>
              <span class="vibe-status-tag vibe-status-tag--live"><i aria-hidden="true"></i>同步中</span>
            </div>
          </div>
          <div class="sg-example sg-example--dont">
            <p class="sg-example-label">错误 · 红色是装饰</p>
            <div class="sg-row">
              <button class="vibe-button" type="button" style="background: var(--accent); color: var(--accent-ink)">保存</button>
              <span class="sg-fake-link">查看详情</span>
            </div>
          </div>
        </div>
        <p class="sg-body">右侧示例故意违规，仅用于对照。判断标准很简单：如果红色按钮被点掉之后界面没有任何信息损失，那它就不是信号。</p>`,
    { scaffold: true },
  );

  const inversion = specimen(
    "激活态 = 黑白反转，不是上色",
    `<div class="sg-row">
          <button class="vibe-button vibe-button--primary" type="button" data-vibe-component="button">主操作</button>
          <button class="vibe-button vibe-button--outline" type="button" data-vibe-component="button">次操作</button>
          <button class="vibe-button vibe-button--text" type="button" data-vibe-component="button">文字操作</button>
          <button class="vibe-button vibe-button--primary" type="button" disabled>禁用</button>
        </div>
        <p class="sg-body">主按钮用 <code>--display</code> 填充 + <code>--bg</code> 文字。开关 ON、选中芯片、今日日期、当前步骤同理。禁用态 <code>opacity .3</code>。</p>`,
  );

  const dashboards = specimen(
    "控制台永远暗色",
    `<div data-sg-pin="dark" class="sg-dark-region">
          <p class="sg-dark-caption">DARK PINNED REGION</p>
          <div class="sg-kv sg-kv--tight">
            <div><dt>--bg</dt><dd><code>#000000</code></dd></div>
            <div><dt>--display</dt><dd><code>#ffffff</code></dd></div>
            <div><dt>--accent</dt><dd><code>#d71921</code></dd></div>
          </div>
          <p class="sg-body">无论页面主题如何，工作台区域都把自己的暗色 token 集重新钉住，让强调色永远是同一个红，也避免前景红与填充红不一致。</p>
        </div>`,
    { scaffold: true },
  );

  return `<section class="sg-section">
      ${sectionHeader("sg-color", "01", "Foundations · Color", "色彩", "暗色优先；灰阶本身即层级。文字用柔白／柔黑以降低眩光。")}
      <div class="sg-grid">${groups}</div>
      <div class="sg-grid sg-grid--3">${greyBudget}${signalBudget}${inversion}</div>
      <div class="sg-grid">${dashboards}</div>
    </section>`;
}

function renderTypography(ctx) {
  const { tokens } = ctx;

  const roles = TYPE_ROLES.map((role) => {
    const family = tokens.shared[role.token] ?? role.family;
    return `<article class="sg-panel sg-panel--wide">
        <div class="sg-panel-head">
          <h3 class="sg-panel-title">${esc(role.label)}</h3>
          <code class="sg-code-inline">${esc(role.token)}</code>
          ${role.pageLevelOnly ? '<span class="sg-badge sg-badge--warn">仅页面级</span>' : ""}
        </div>
        <p class="sg-rule">${esc(role.usage)}</p>
        <div class="sg-stage sg-stage--specimen">
          <p class="${esc(role.sampleClass)}">${esc(role.sample)}</p>
        </div>
        <p class="sg-body sg-body--tight">${esc(role.rule)}</p>
        <p class="sg-body sg-body--tight sg-muted">实际解析字体栈：<code>${esc(family)}</code></p>
      </article>`;
  }).join("");

  const scaleRows = Object.entries(tokens.shared)
    .filter(([name]) => name.startsWith("--vibe-type-") || name === "--vibe-type-label")
    .map(([name, value]) => {
      const px = Number.parseFloat(value);
      return `<tr>
            <td class="sg-cell-token"><code>${esc(name)}</code></td>
            <td class="sg-cell-value"><code>${esc(value)}</code></td>
            <td><span class="sg-type-sample" style="font-size:min(${px}px, 40px)">资产 1,234,567.89</span></td>
          </tr>`;
    })
    .join("");

  const scale = specimen(
    "字号比例尺",
    `<table class="sg-table">
          <thead><tr><th>token</th><th>值</th><th>样张</th></tr></thead>
          <tbody>${scaleRows}</tbody>
        </table>
        <p class="sg-body">上游站点的标题序列是 40 / 32 / 24 / 20 / 16 / 14 / 11。本产品按 <code>DESIGN.md</code> 的适配条款，只用这一组 4px 基准的排版级差 token，不额外引入第二套字号语言；两套序列不混用。现共 <strong>13 档</strong>，覆盖产品里在用的每一个字号取值——<strong>没有一档是为了凑整齐而存在的，也没有一个取值落在表外</strong>。</p>
        <p class="sg-body">字号分两族。<strong>文字族</strong>（24px 及以下）步长密集，用来排句子与标签；<strong>展示族</strong>（<code>display-sm</code> 26px 起）用来排"一屏一个的大数字"，两族不互相替代：给正文用展示档会让字号突然跳档，给大数字用正文档会让它淹没在页面里。</p>
        <p class="sg-body"><code>--vibe-type-micro</code>（10px）是文字族最小一档，专供"等宽大写微标签"——字段标签、表头、眉标、快捷键提示。它必须与 <code>--f-mono</code> + <code>letter-spacing: .08–.14em</code> + <code>text-transform: uppercase</code> 同时出现，<strong>不要用它排正文</strong>。</p>
        <p class="sg-body"><code>--vibe-type-body-xs</code>（13px）是<strong>产品的正文基准</strong>——<code>body</code> 元素本身用的就是这一档，对话框正文、下拉触发器、日历格、次级按钮文字、空态提示同属这一层。<code>--vibe-type-title</code>（20px）由小标题与仪表数字共用。</p>
        <p class="sg-body sg-muted">这一版之前，产品的真实字号与这张表是脱节的：10px 那一档根本不存在（40 处散落为 9px / 10px 字面量），13px / 17px / 20px / 26px / 42px 等 36 处取值也在表外，另有两档（<code>display-sm</code>、<code>title</code>）被引用却从未定义。现已全部收敛，详见偏差登记表 D-18 与 D-21。</p>`,
    { scaffold: true },
  );

  const dotoRule = specimen(
    "Doto 的权重上限",
    `<div class="sg-grid sg-grid--2">
          <div class="sg-example sg-example--do">
            <p class="sg-example-label">正确 · 字重 500</p>
            <p class="sg-doto-demo" style="font-weight:500">2026 78% 0</p>
          </div>
          <div class="sg-example sg-example--dont">
            <p class="sg-example-label">错误 · 字重 800，点粘连、0 出现尖顶</p>
            <p class="sg-doto-demo" style="font-weight:800">2026 78% 0</p>
          </div>
        </div>`,
    { scaffold: true },
  );

  const punctuation = specimen(
    "点阵标点的归属",
    `<p class="sg-body">上游在点阵语境下用圆点单元承载 <code>:</code> <code>·</code> <code>…</code>（<code>.colon</code> / <code>.pdot</code> / <code>.ellip</code>，直径由 <code>--pxd</code> 控制），而不是字体字形。本产品当前没有点阵排字场景，因此未实现这一层；一旦出现时钟、计时或点阵标题，必须按上游补齐，不可直接写字形标点。</p>`,
    { rule: "这是一项已知的组件缺口，已登记在治理章节。" },
  );

  return `<section class="sg-section">
      ${sectionHeader("sg-type", "02", "Foundations · Typography", "字体排版", "五种角色各有其职。层级由字号跳变与角色区分承担，而不是靠字重与颜色堆叠。")}
      <div class="sg-grid sg-grid--2">${roles}</div>
      <div class="sg-grid">${scale}</div>
      <div class="sg-grid sg-grid--2">${dotoRule}${punctuation}</div>
    </section>`;
}

function renderGeometry(ctx) {
  const { tokens } = ctx;
  const shared = tokens.shared;

  const spacing = `<table class="sg-table">
      <thead><tr><th>token</th><th>值</th><th>刻度</th><th>关系语义</th></tr></thead>
      <tbody>${SPACING_STEPS.map((step) => {
        const value = shared[step.token] ?? "—";
        const px = Number.parseFloat(value);
        return `<tr>
            <td class="sg-cell-token"><code>${esc(step.token)}</code></td>
            <td class="sg-cell-value"><code>${esc(value)}</code></td>
            <td><span class="sg-spacing-bar" style="width:${px}px"></span></td>
            <td class="sg-cell-role">${esc(step.relation)}</td>
          </tr>`;
      }).join("")}</tbody>
    </table>
    <p class="sg-body">基准 4px，只用表内这些档位，不写任意 px。当你伸手去拿一根分隔线时，通常真正需要的是更多留白。</p>`;

  const radius = `<div class="sg-grid sg-grid--3">${RADIUS_ITEMS.map(
    (item) => `<div class="sg-radius-cell">
        <span class="sg-radius-box" style="border-radius: var(${esc(item.token)})"></span>
        <code class="sg-code-inline">${esc(item.token)} · ${esc(shared[item.token] ?? "—")}</code>
        <p class="sg-body sg-body--tight">${esc(item.usage)}</p>
        <p class="sg-body sg-body--tight sg-muted">${esc(item.note)}</p>
      </div>`,
  ).join("")}</div>`;

  const elevation = `<table class="sg-table">
      <thead><tr><th>层级</th><th>z-index</th><th>用于</th></tr></thead>
      <tbody>${ELEVATION_LAYERS.map(
        (layer) =>
          `<tr><td class="sg-cell-token"><code>${esc(layer.label)}</code></td><td class="sg-cell-value"><code>${esc(layer.value)}</code></td><td class="sg-cell-role">${esc(layer.usage)}</td></tr>`,
      ).join("")}</tbody>
    </table>
    <p class="sg-body">层次只由 z-index 与细线表达。零阴影；玻璃卡的 backdrop-blur 是材质，不是阴影。</p>`;

  const motion = `<table class="sg-table">
      <thead><tr><th>场景</th><th>值</th><th>说明</th></tr></thead>
      <tbody>${MOTION_ITEMS.map(
        (item) =>
          `<tr><td class="sg-cell-token"><code>${esc(item.name)}</code></td><td class="sg-cell-value"><code>${esc(item.value)}</code></td><td class="sg-cell-role">${esc(item.detail)}</td></tr>`,
      ).join("")}</tbody>
    </table>
    <p class="sg-body">缓动只有 <code>ease-in-out</code>。没有弹簧、没有回弹、没有视差。运行时 token：<code>--ease</code>、<code>--vibe-duration-fast</code> = ${esc(shared["--vibe-duration-fast"] ?? "")}、<code>--vibe-duration-theme</code> = ${esc(shared["--vibe-duration-theme"] ?? "")}。</p>`;

  const controls = `<div class="sg-kv">
      <div><dt>紧凑控件高</dt><dd><code>${esc(shared["--vibe-control-height-compact"] ?? "—")}</code></dd></div>
      <div><dt>标准控件高</dt><dd><code>${esc(shared["--vibe-control-height"] ?? "—")}</code></dd></div>
      <div><dt>水平内边距</dt><dd><code>var(--vibe-control-padding-inline)</code> = ${esc(shared["--vibe-control-padding-inline"] ?? "—")}</dd></div>
    </div>
    <p class="sg-body">可见轮廓可以很薄（状态标签只有 24px 高），但交互命中区始终不得低于 40px —— 见无障碍章节。</p>`;

  return `<section class="sg-section">
      ${sectionHeader("sg-geometry", "03", "Foundations · Geometry", "间距 · 圆角 · 层次 · 动效", "几何来自 4px 刻度、三种圆角与细线。深度用 z-index 表达，不用阴影。")}
      <div class="sg-grid sg-grid--2">${specimen("间距刻度", spacing)}${specimen("圆角", radius)}</div>
      <div class="sg-grid sg-grid--2">${specimen("层级", elevation)}${specimen("动效", motion)}</div>
      <div class="sg-grid">${specimen("控件尺寸", controls)}</div>
    </section>`;
}

function renderDotLanguage(ctx) {
  const { dotGlyphs } = ctx;

  const grid = dotGlyphs
    .map(
      ([name, rows]) => `<div class="sg-glyph-cell">
        ${dotGlyphMarkup(rows, 30)}
        <code class="sg-code-inline">${esc(name)}</code>
      </div>`,
    )
    .join("");

  const sizes = [`<div class="sg-row sg-row--end">`]
    .concat(
      ["24", "30", "48", "72"].map((size) =>
        dotGlyphs[0]
          ? `<div class="sg-glyph-cell">${dotGlyphMarkup(dotGlyphs[0][1], Number(size))}<code class="sg-code-inline">${esc(size)}px</code></div>`
          : "",
      ),
    )
    .concat([`</div>`])
    .join("");

  const rules = specimen(
    "九宫格契约",
    `<ul class="sg-list">
          <li>图标是 9×9 的 CSS grid，每个点亮的格子是一个 <strong>完整圆点</strong>（<code>border-radius: 50%</code>）。</li>
          <li>尺寸由单一变量驱动（本产品为 <code>--vibe-dot-icon-size</code>，上游为 <code>--gs</code>），点间隙按尺寸的 1/20 等比缩放。</li>
          <li>绝不用 <code>mask</code> 或 <code>clip-path</code> 裁切点阵——那会把圆点切成半圆。</li>
          <li>功能性小图标（按钮、输入框、导航内）仍用 1.5px 线形 SVG 以保证可读性，见下一节的图标集。</li>
          <li>字形比特直接来自 <code>vibe-dot-icon.tsx</code>，因此本页展示的就是线上真实字形。</li>
        </ul>`,
  );

  return `<section class="sg-section">
      ${sectionHeader("sg-dot", "04", "Foundations · Dot matrix", "点阵语言", "点阵是这套系统的母语。数字、图标与标点共用同一种圆点单元。")}
      <div class="sg-grid sg-grid--2">
        ${specimen("全部点阵字形", `<div class="sg-glyph-grid">${grid}</div>`)}
        ${specimen("可缩放性", `${sizes}<p class="sg-body">只改一个变量即可整枚放大，点间距自动等比跟随，不会被拉变形。</p>`)}
      </div>
      <div class="sg-grid">${rules}</div>
    </section>`;
}

function renderBackground() {
  return `<section class="sg-section">
      ${sectionHeader("sg-field", "05", "Foundations · Background", "背景点场", "稀疏的圆点层，取所在表面的局部反色：暗底上更亮，亮底上更暗；一个连续场跨过明暗两侧各自成立。")}
      <div class="sg-grid">
        ${specimen(
          "三层模型：Background → Dots → Card",
          `<p class="sg-caption" style="margin-bottom:12px">同一片点场跨越明暗两块表面，各自局部反色</p>
            <div class="sg-dot-blocks">
              <div class="sg-dot-block sg-dot-block--base"><p>暗面 · 点反色为亮</p></div>
              <div class="sg-dot-block sg-dot-block--inverse"><p>亮面 · 点反色为暗</p></div>
            </div>
            <p class="sg-caption" style="margin:16px 0 12px">卡片浮在点层之上并将其盖住</p>
            <div class="sg-layer-model__cards">
              <div class="sg-layer-card">玻璃卡 · 无边框 · backdrop-filter blur · 盖住点阵</div>
              <div class="sg-layer-card">卡片表面不出现点</div>
            </div>
            <ul class="sg-list">
              <li>点直径约 1.3px、间距约 120px：凑近能看见，但从不与内容竞争。密于约 64px 即为错误。</li>
              <li>实现必须是一层半透明白点加 <code>mix-blend-mode: difference</code>，靠混合自动反色，<strong>不要</strong>为每个主题各写一种点色。</li>
              <li>层必须位于卡片之下（页面用 <code>body::before</code>，独立暗色区域用自己的 <code>::before</code> 加 <code>z-index:-1</code>）。</li>
              <li><code>background-attachment: fixed</code> 让整页对齐为一张视口网格。</li>
              <li>点阵只作背景。卡片浮在其上并盖住点，点只在卡片之间的缝隙里可见。</li>
            </ul>`,
        )}
      </div>
    </section>`;
}

function renderComponents(ctx) {
  const { lineIcons, dotGlyphs } = ctx;
  const glyphByName = new Map(dotGlyphs);

  const lineIconGrid = lineIcons
    .map(
      ([name, inner]) => `<div class="sg-icon-cell">
        <svg aria-hidden="true" class="vibe-icon" fill="none" focusable="false" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24">${inner}</svg>
        <code class="sg-code-inline">${esc(name)}</code>
      </div>`,
    )
    .join("");

  const buttons = specimen(
    "按钮",
    `<div class="sg-row">
          <button class="vibe-button vibe-button--primary" type="button" data-vibe-component="button" data-vibe-variant="primary">刷新全部来源</button>
          <button class="vibe-button vibe-button--outline" type="button" data-vibe-component="button" data-vibe-variant="outline">断开来源</button>
          <button class="vibe-button vibe-button--text" type="button" data-vibe-component="button" data-vibe-variant="text">取消</button>
          <button class="vibe-button vibe-button--outline" type="button" disabled>不可用</button>
        </div>
        <p class="sg-body">默认变体是 <code>outline</code>，因为多数动作是次级动作。标签用 Geist Mono 大写字距 .04em。悬停只降透明度，永不变色。</p>`,
    { rule: "契约：.vibe-button + .vibe-button--primary|outline|text，命中区 ≥44px。" },
  );

  const fields = specimen(
    "输入字段",
    `<div class="vibe-field">
          <label class="vibe-field__label" for="sg-input">只读凭证 · API KEY</label>
          <input class="vibe-field__input" id="sg-input" placeholder="粘贴只读授权材料" type="text" value="">
        </div>
        <div class="vibe-field" style="margin-top:16px">
          <label class="vibe-field__label" for="sg-input-disabled">已断开</label>
          <input class="vibe-field__input" id="sg-input-disabled" type="text" value="已停止同步" disabled>
        </div>
        <p class="sg-body">聚焦只改边框色为 <code>--primary</code>：没有发光、没有强调色。禁用态 <code>opacity .3</code>。</p>`,
    { rule: "契约：.vibe-field > .vibe-field__label + .vibe-field__input；标签用 var(--vibe-type-micro) 大写等宽。" },
  );

  const textarea = specimen(
    "多行输入",
    `<div class="vibe-field">
          <label class="vibe-field__label" for="sg-textarea">备注</label>
          <textarea class="vibe-field__input" id="sg-textarea" placeholder="用于记录该来源的观察说明">同日导入金额优先，其次手动记录，再次自动观测。</textarea>
        </div>`,
  );

  const select = specimen(
    "下拉选择",
    `<div class="vibe-select vibe-select--wide">
          <button aria-expanded="false" class="vibe-select__trigger" type="button">
            <span>CNY</span><span aria-hidden="true" class="vibe-select__chevron"></span>
          </button>
          <div class="vibe-select__options">
            <button aria-selected="true" class="vibe-select__option" type="button">CNY<span class="vibe-select__selected-mark"></span></button>
            <button aria-selected="false" class="vibe-select__option" type="button">USD</button>
            <button aria-selected="false" class="vibe-select__option" type="button">HKD</button>
          </div>
        </div>
        <p class="sg-body">选中项底色为 <code>--raised</code>，右侧 6×6 方块用强调色标记——这是「当前选择」这一信号，属于少数允许用红的场景。</p>`,
    { scaffold: true, rule: "面板在此静态展开以便检视；线上由组件挂在 portal 中定位。" },
  );

  const choice = specimen(
    "复选行",
    `<label class="vibe-choice"><input type="checkbox" checked><span>已在总资产中计入该来源</span></label>
        <div style="height:8px"></div>
        <label class="vibe-choice"><input type="checkbox"><span>仅观察，不计入汇总</span></label>`,
    { rule: "选中态是边框变 --display 加 --raised 底，不是上色。" },
  );

  const tags = specimen(
    "状态标签",
    `<div class="sg-row">
          ${[
            ["muted", "待分类"],
            ["live", "同步中"],
            ["signal", "需要授权"],
            ["success", "已刷新"],
            ["warning", "数据过期"],
            ["error", "同步失败"],
          ]
            .map(
              ([tone, text]) =>
                `<span class="vibe-status-tag vibe-status-tag--${tone}" data-vibe-tone="${tone}"><i aria-hidden="true"></i>${esc(text)}</span>`,
            )
            .join("")}
        </div>
        <p class="sg-body">标签里的 6px 圆点是状态载体：<code>muted</code> 与 <code>success</code> 的文字仍保持次级灰，只让圆点承担颜色；只有 <code>signal</code> 与 <code>error</code> 才让整个标签上色。</p>`,
    { rule: "契约：.vibe-status-tag--muted|live|signal|success|warning|error。" },
  );

  const segmented = specimen(
    "分段条",
    `<div class="sg-stack">
          <div>
            <p class="sg-caption">单一段 · 全额填充</p>
            <div aria-label="资产分布" class="vibe-segmented-bar" role="img">
              ${Array.from({ length: 12 }, () => '<span class="is-filled is-primary is-group-1"></span>').join("")}
            </div>
          </div>
          <div>
            <p class="sg-caption">多来源 · 分组透明度</p>
            <div aria-label="来源分布" class="vibe-segmented-bar" role="img">
              ${Array.from({ length: 12 }, (_, index) => {
                const group = (Math.floor(index / 4) % 3) + 1;
                return `<span class="is-filled is-primary is-group-${group}"></span>`;
              }).join("")}
            </div>
          </div>
          <div>
            <p class="sg-caption">越限与不可读 · 唯一允许红/错的场合</p>
            <div aria-label="完整性与不可读" class="vibe-segmented-bar" role="img">
              ${Array.from({ length: 12 }, (_, index) =>
                index < 8
                  ? `<span class="is-filled is-primary is-group-1"></span>`
                  : index < 10
                    ? `<span class="is-filled is-signal"></span>`
                    : `<span class="is-filled is-error"></span>`,
              ).join("")}
            </div>
          </div>
        </div>
        <p class="sg-body">离散方格、2px 间隙、直角无圆角。空槽是 <code>--line-2</code> 的低透明度版本。永远与一个数值读数并置，不能单独承担信息。</p>`,
    { rule: "契约：.vibe-segmented-bar > span，状态类 is-filled / is-muted / is-signal / is-error / is-group-1..3。" },
  );

  const metric = specimen(
    "主数值与动效计数",
    `<div class="vibe-metric" data-vibe-component="metric">
          <span class="vibe-metric__value"><span aria-label="1,234,567.89" class="vibe-live-counter" data-counter-state="idle" data-counter-target="1,234,567.89" data-sg-count>0.00</span></span>
          <span class="vibe-metric__unit">USD</span>
        </div>
        <p class="sg-body"><code>.vibe-metric</code> 用 Doto 500、tabular-nums、负字距 <code>-0.045em</code>，单位回落到等宽小字。计数动画 1200ms、三次缓动，且遵守 <code>prefers-reduced-motion</code>；滚动进入视口才开始。</p>`,
    { rule: "契约：.vibe-metric > .vibe-metric__value + .vibe-metric__unit。" },
  );

  const notices = specimen(
    "内联通知",
    `<div class="sg-stack">
          ${[
            ["error", "error", "SYNC FAILED", "来源拒绝读取，最后成功数据仍计入总资产，不降低总额估值完整性。"],
            ["success", "check", "SAVED", "已保存该来源的只读授权，未回显凭证原文。"],
            ["info", "key", "READ ONLY", "该凭证仅具备读取行情与持仓权限。"],
          ]
            .map(
              ([tone, glyph, code, message]) => `<div class="vibe-notice vibe-notice--${tone}" data-vibe-tone="${tone}">
            ${dotGlyphMarkup(glyphByName.get(glyph) ?? glyphByName.get("error") ?? [], 24)}
            <div class="vibe-notice__content">
              <strong class="vibe-notice__code">${esc(code)}</strong>
              <div class="vibe-notice__message">${esc(message)}</div>
            </div>
          </div>`,
            )
            .join("")}
        </div>
        <p class="sg-body">这是状态色唯一被允许填充一块区域的场合：图标 + 3px 左边线 + 约 9% 的色底。上游明确不用浮动 toast，因此状态以这种内联形式常驻。</p>`,
    { rule: "契约：.vibe-notice--error|success|info + .vibe-notice__code / __message。" },
  );

  const dialog = specimen(
    "对话框",
    `<button class="vibe-button vibe-button--outline" type="button" data-sg-open-dialog>打开对话框</button>
        <p class="sg-body">标题用 <code>--f-head</code> / 600 / <code>--vibe-type-subheading</code>（18px）；页脚是「文字取消 + 主态确认」。<kbd class="sg-kbd">Esc</kbd> 关闭，焦点在遮罩内循环，关闭后回到触发元素。</p>`,
    { rule: "契约：.vibe-dialog-overlay > .vibe-dialog > __header / __body / __footer。" },
  );

  const menu = specimen(
    "下拉菜单",
    `<div class="vibe-menu" data-sg-menu>
          <button aria-expanded="false" aria-haspopup="menu" class="vibe-button vibe-button--text vibe-menu__trigger" type="button">更多操作</button>
          <div class="vibe-menu__panel" role="menu" hidden>
            <button class="vibe-menu__item" role="menuitem" type="button">重新授权</button>
            <button class="vibe-menu__item" role="menuitem" type="button">恢复同步</button>
            <button class="vibe-menu__item vibe-menu__item--danger" role="menuitem" type="button">删除来源数据</button>
          </div>
        </div>
        <p class="sg-body">悬停底色是 <code>--raised</code>，不是强调色。危险项用 <code>--accent-text</code> 作前景，而不是红底白字。</p>`,
    { rule: "契约：.vibe-menu > trigger(.vibe-button--text) + .vibe-menu__panel[role=menu]。" },
  );

  const tooltip = specimen(
    "提示",
    `<span class="vibe-tooltip">
          <span class="vibe-status-tag vibe-status-tag--muted" tabindex="0"><i aria-hidden="true"></i>未估值</span>
          <span class="vibe-tooltip__content" role="tooltip">已读取到数量，但没有可靠计价货币价格</span>
        </span>
        <p class="sg-body">默认向下对齐居中；<code>data-align="end"</code> 可右对齐。右侧浮层变体（<code>--floating</code>）挂到 body 并在滚动时立即消失。</p>`,
    { rule: "契约：.vibe-tooltip > 触发器 + .vibe-tooltip__content[role=tooltip]。" },
  );

  const verification = specimen(
    "验证码分格输入",
    `<div class="vibe-verification-code">
          <label class="vibe-field__label" for="sg-code">备用登录码</label>
          <div class="vibe-verification-code__control">
            <span aria-hidden="true" class="vibe-verification-code__slots">
              ${Array.from({ length: 6 }, (_, index) => `<span class="vibe-verification-code__slot" data-sg-slot="${index}"></span>`).join("")}
            </span>
            <input aria-label="备用登录码" autocomplete="one-time-code" class="vibe-verification-code__input" id="sg-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" type="text">
          </div>
        </div>
        <p class="sg-body">六个 40×50px 槽位用 Doto 承载数字，真实输入框透明覆盖其上以保证原生输入与无障碍。聚焦时当前槽边框变 <code>--primary</code>；<code>aria-invalid="true"</code> 时全部转 <code>--error</code>。宽度不足 360px 时槽位收窄到 36px。</p>`,
    { rule: "这是本产品唯一自行组合的输入控件，其余输入统一走 .vibe-field。" },
  );

  const dateField = specimen(
    "日期字段与日历",
    `<button aria-expanded="true" class="vibe-date-field__trigger" type="button">
          <span>2026-10-16</span><span aria-hidden="true" class="vibe-date-field__calendar-icon"></span>
        </button>
        <div class="sg-inline-calendar">
          <div class="vibe-date-field__calendar-head">
            <button aria-label="上个月" class="vibe-date-field__month-button is-previous" type="button"></button>
            <strong>2026 年 10 月</strong>
            <button aria-label="下个月" class="vibe-date-field__month-button is-next" type="button"></button>
          </div>
          <div class="vibe-date-field__weekday-row">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${esc(day)}</span>`).join("")}</div>
          <div class="vibe-date-field__day-grid">
            ${Array.from({ length: 16 }, (_, index) => {
              const day = index + 1;
              const cls = day === 16 ? " is-today" : "";
              return `<button class="vibe-date-field__day${cls}" type="button">${day}</button>`;
            }).join("")}
          </div>
        </div>
        <p class="sg-body">日期数字用 Doto；今天 = 反转填充；已选 = <code>--display</code> 描边。这个控件服务于「按上海自然日保存」的手工记录，日历本身不写入任何数据。</p>`,
    { scaffold: true, rule: "日历在此内联展开以便检视；线上以 fixed 定位浮层呈现。" },
  );

  const table = specimen(
    "数据表",
    `<table class="vibe-data-table sg-table sg-table--data">
          <thead><tr><th>资产</th><th>数量</th><th>市值</th><th>平台盈亏</th></tr></thead>
          <tbody>
            <tr><td>AAPL</td><td>12</td><td>2,431.20</td><td>+118.40</td></tr>
            <tr><td>NVDA</td><td>4</td><td>861.08</td><td>−32.10</td></tr>
            <tr class="is-unvalued"><td>PEPE</td><td>1,200,000</td><td>未估值</td><td>数据不足</td></tr>
          </tbody>
        </table>
        <p class="sg-body">等宽单元格、大写等宽表头、细线行、<strong>无斑马纹</strong>。不可读或未估值的行整体转为 <code>--error</code>，这是如实降级，不是错误提示。</p>`,
    { rule: "契约：.vibe-data-table th / td，配合 .is-unvalued 修饰符。" },
  );

  const dataRow = specimen(
    "数据行与预览列表",
    `<div class="vibe-data-row sg-row-between"><span>观察钱包 · Base</span><strong>1,204.55 USD</strong></div>
        <div class="vibe-data-row sg-row-between"><span>长桥 · 证券账户</span><strong>88,320.10 HKD</strong></div>
        <dl class="vibe-preview-list">
          <div><dt>授权状态</dt><dd>只读 · 已校验</dd></div>
          <div><dt>最近校验</dt><dd>2026-10-16 16:40 GMT+8</dd></div>
          <div><dt>权限摘要</dt><dd>行情读取、持仓读取</dd></div>
        </dl>
        <p class="sg-body">来源详情用 <code>.vibe-preview-list</code> 展示授权摘要。这里<strong>绝不回显凭证原文</strong>，只显示范围与时间。</p>`,
    { rule: "契约：.vibe-data-row（末行自动去掉下边线）与 .vibe-preview-list > div > dt/dd。" },
  );

  const glass = specimen(
    "认证玻璃面",
    `<div class="vibe-auth-surface sg-auth-demo">
          <p class="sg-eyebrow">SECURE DEVICE</p>
          <p class="sg-auth-title">个人资产看板</p>
          <p class="sg-body sg-body--tight">玻璃面无边框、8px 圆角、blur 16px。它是材质，不是阴影——所以卡片上方永远不叠加 box-shadow。</p>
          <div class="sg-row" style="margin-top:16px">
            <button class="vibe-button vibe-button--primary" type="button">使用 Passkey 验证</button>
            <button class="vibe-button vibe-button--text" type="button">进入演示模式</button>
          </div>
        </div>`,
    { rule: "契约：.vibe-auth-surface（--glass + backdrop-filter blur(16px)）。" },
  );

  const emptyState = specimen(
    "空态",
    `<div class="sg-empty">
          ${dotGlyphMarkup(glyphByName.get("computer") ?? [], 30)}
          <p class="sg-empty-title">还没有接入任何资产来源</p>
          <p class="sg-body sg-body--tight">先连接一个只读来源，或创建手工资产记录。</p>
          <div class="sg-row" style="justify-content:center;margin-top:16px">
            <button class="vibe-button vibe-button--primary" type="button">接入来源</button>
          </div>
        </div>
        <p class="sg-body">虚线细线边框、9×9 点阵字形、标题 + 一个主按钮、一行说明。<strong>不用插画、不用 emoji、不写多行长文案。</strong></p>`,
    { goal: true, rule: "这是规范目标，尚未组件化；现网实现使用的是细线变体，见偏差登记 D-15。" },
  );

  const icons = specimen(
    "线形图标集",
    `<div class="sg-glyph-grid sg-glyph-grid--icons">${lineIconGrid}</div>
        <p class="sg-body">22px 视口、1.5px 描边、圆端圆角、<code>currentColor</code>。默认色是 <code>--primary</code>，绝不用灰色默认值。图标不自带颜色语义，也绝不填充。</p>`,
    { rule: "契约：.vibe-icon，形状来自 vibe-icon.tsx 的 symbol 集合。" },
  );

  return `<section class="sg-section">
      ${sectionHeader("sg-components", "06", "Components", "组件", "每个组件都给出真实 class 契约、状态与使用边界。所有样张都由仓库真实样式渲染，不是重绘的示意图。")}
      <div class="sg-grid sg-grid--2">
        ${buttons}${tags}
        ${fields}${textarea}
        ${select}${choice}
        ${metric}${notices}
      </div>
      <div class="sg-grid">${segmented}</div>
      <div class="sg-grid sg-grid--2">${dialog}${menu}</div>
      <div class="sg-grid sg-grid--3">${tooltip}${verification}${glass}</div>
      <div class="sg-grid">${table}</div>
      <div class="sg-grid sg-grid--2">${dataRow}${dateField}</div>
      <div class="sg-grid">${icons}</div>
      <div class="sg-grid">${emptyState}</div>
    </section>`;
}

function renderStates(ctx) {
  const { tokens } = ctx;
  const stateRows = STATE_MACHINE.map((state) => {
    const tag = `<span class="vibe-status-tag vibe-status-tag--${state.tone}"><i aria-hidden="true"></i>${esc(state.name)}</span>`;
    return `<tr>
        <td>${tag}</td>
        <td class="sg-cell-role">${esc(state.shape)}</td>
        <td class="sg-cell-role">${esc(state.usage)}</td>
      </tr>`;
  }).join("");

  const machine = specimen(
    "统一状态机",
    `<table class="sg-table">
          <thead><tr><th>状态</th><th>形状</th><th>使用</th></tr></thead>
          <tbody>${stateRows}</tbody>
        </table>
        <p class="sg-body">全站共用这五个状态名，不得另造。表达顺序恒为<strong>形状 → 标签 → 颜色</strong>：颜色是第三层信息，色盲用户必须能在只有形状与文字的情况下完成操作。</p>`,
    { rule: "契约：idle / running / needs-input / done / error。" },
  );

  const profit = specimen(
    "金融真值：涨红跌绿",
    `<div class="sg-stack sg-stack--tight">
          <div class="sg-row-between"><span class="sg-caption">中国市场配色（默认）</span></div>
          <div class="sg-row">
            <span class="profit-color-value" data-profit-color-scheme="red-up" data-profit-direction="positive"><strong>+12,431.20</strong></span>
            <span class="profit-color-value" data-profit-color-scheme="red-up" data-profit-direction="negative"><strong>−3,208.55</strong></span>
            <span class="sg-caption">↑ 用 --error 红，↓ 用 --success 绿</span>
          </div>
          <div class="sg-row-between" style="margin-top:12px"><span class="sg-caption">可切换的国际配色</span></div>
          <div class="sg-row">
            <span class="profit-color-value" data-profit-color-scheme="green-up" data-profit-direction="positive"><strong>+12,431.20</strong></span>
            <span class="profit-color-value" data-profit-color-scheme="green-up" data-profit-direction="negative"><strong>−3,208.55</strong></span>
            <span class="sg-caption">↑ 用 --success 绿，↓ 用 --error 红</span>
          </div>
        </div>
        <p class="sg-body">颜色由 <code>data-profit-color-scheme</code> 与 <code>data-profit-direction</code> 两个属性决定，用户可在设置里切换。默认遵循中国市场惯例。数字本身仍须带显式正负号——颜色是可访问性之上的增强，不是唯一线索。</p>`,
    { scaffold: true, rule: "契约来自 globals.css 的 .profit-color-value，属于已登记的遗留层。" },
  );

  const truth = specimen(
    "不可伪造的降级表达",
    `<div class="sg-stack sg-stack--tight">
          <div class="sg-row-between"><span>未估值资产</span><strong>未估值</strong></div>
          <div class="sg-row-between"><span>累计净投入（缺初始投入事实）</span><strong>数据不足</strong></div>
          <div class="sg-row-between"><span>总量估值完整性</span><strong>汇总不完整</strong></div>
          <div class="sg-row-between"><span>总额估值完整性 · 持仓行情未接入</span><strong>总额完整</strong></div>
        </div>
        <ul class="sg-list">
          <li>缺失估值显示为「未估值」，<strong>绝不折算为零</strong>，并使总资产标明汇总不完整。</li>
          <li>「持仓行情未接入」不等于「未估值」，因此不降低总额估值完整性。</li>
          <li>来源账户总额已经包含但缺少持仓级行情的项目，不能把差额解释成市值或盈亏。</li>
          <li>稳定币兜底 <code>1 USDT = 1 USD</code> 必须显式标注，且不得称为实时行情。</li>
          <li>没有持有证券时，正式日结以约定的上海自然日加密资产截点形成。</li>
        </ul>
        <p class="sg-body">这些不是文案偏好，而是设计约束：界面必须有能力表达「我不知道」，并且不为好看而补零。等宽对齐与显式币种是同一约束的另一半——见下。</p>
        <div class="sg-grid sg-grid--2" style="margin-top:12px">
          <div class="sg-example sg-example--do">
            <p class="sg-example-label">正确 · 精度、单位、对齐</p>
            <pre class="sg-mono-block">1,204.55000000  ETH
88,320.10       HKD
未估值           —</pre>
          </div>
          <div class="sg-example sg-example--dont">
            <p class="sg-example-label">错误 · 截断、无单位、比例字</p>
            <pre class="sg-mono-block">1.2k
88320.1
0</pre>
          </div>
        </div>`,
    { scaffold: true },
  );

  const tokensNote = `<p class="sg-body">涨跌色映射到既有 token：<code>--error</code> = ${esc(tokens.dark["--error"] ?? "")}（暗）/ ${esc(tokens.light["--error"] ?? "")}（亮），<code>--success</code> = ${esc(tokens.dark["--success"] ?? "")}（暗）/ ${esc(tokens.light["--success"] ?? "")}（亮）。没有为涨跌新造颜色 token。</p>`;

  return `<section class="sg-section">
      ${sectionHeader("sg-states", "07", "Patterns · State & truth", "状态机与金融真值", "状态先由形状与标签表达；而金融数字必须有能力说「我不知道」。")}
      <div class="sg-grid sg-grid--2">${machine}${profit}</div>
      <div class="sg-grid">${truth}${tokensNote}</div>
    </section>`;
}

function renderAccessibility(ctx) {
  const { tokens } = ctx;
  const shared = tokens.shared;

  const touch = specimen(
    "命中区不得低于 40px",
    `<div class="sg-hit-target-demo">
          <span class="sg-hit-outline"><button class="vibe-button vibe-button--outline sg-slim" type="button">刷新</button></span>
          <span class="sg-caption">可见轮廓 24px，实际命中区 40px</span>
        </div>
        <p class="sg-body">契约条款：即使可见控件使用上游的 6px 技术圆角与很薄的轮廓，交互元素的命中区也必须 ≥40px，标准控件高为 <code>${esc(shared["--vibe-control-height"] ?? "44px")}</code>。实现方式是在控件外保留一层 40px 高的包裹容器，或用伪元素向上下各外扩。</p>`,
    { scaffold: true, rule: "这是本产品对上游的显式适配条款，登记在 DESIGN.md 第 3 节。" },
  );

  const focus = specimen(
    "可见焦点",
    `<div class="sg-row">
          <button class="vibe-button vibe-button--outline sg-focus-demo" type="button">聚焦环示意</button>
          <input class="vibe-field__input sg-focus-demo sg-focus-demo--input" type="text" value="聚焦时边框转 --primary">
        </div>
        <p class="sg-body">按钮用 <code>outline: 2px solid var(--primary)</code> 且 <code>offset 3px</code>；输入框只改边框色，不加发光。焦点可见性不是可选项——它是键盘可用的前提。</p>`,
    { scaffold: true },
  );

  const motion = specimen(
    "减弱动效",
    `<p class="sg-body">运行时共有 9 处 <code>@media (prefers-reduced-motion: reduce)</code> 规则与 5 处 TS 侧的 <code>matchMedia</code> 检查。减弱动效时：过渡被移除、计数动画直接落位、装饰性旋转停止——但<strong>状态文字必须保留</strong>。</p>
        <p class="sg-body">换言之，动效可以消失，信息不可以消失。</p>`,
  );

  const breakpointRows = BREAKPOINTS.map(
    (bp) =>
      `<tr><td class="sg-cell-token"><code>${esc(bp.label)}</code></td><td class="sg-cell-value"><code>${esc(bp.min)}${bp.max === "—" ? "+" : "–" + bp.max}</code></td><td class="sg-cell-role">${esc(bp.behaviour)}</td></tr>`,
  ).join("");

  const responsive = specimen(
    "断点策略",
    `<table class="sg-table">
          <thead><tr><th>档位</th><th>px</th><th>行为</th></tr></thead>
          <tbody>${breakpointRows}</tbody>
        </table>
        <p class="sg-body">运行时实际出现的断点值更多（359 / 639 / 640 / 720 / 959 / 1023 / 1199 / 1359 / 1439），这是既有实现的现状。规范要求：<strong>新增样式只允许使用上表四档</strong>，额外断点需在代码评审中说明理由。</p>`,
    { rule: "这是一项已登记的全仓库偏差：断点未完全收敛。" },
  );

  const wcag = specimen(
    "无障碍底线",
    `<ul class="sg-list">
          <li>正文对比度 ≥ 4.5:1，大字 ≥ 3:1。强调色作为前景时必须用 <code>--accent-text</code>（暗色提亮、亮色压深），不得直接用填充红当文字。</li>
          <li>全部功能可键盘完成，Tab 顺序与视觉顺序一致；对话框内焦点循环，<kbd class="sg-kbd">Esc</kbd> 关闭并归还焦点。</li>
          <li>语义化标签与 ARIA：状态标签、分段条、日历、验证码都带可访问名。</li>
          <li>文本放大到 200% 不破版；表格横向滚动而不截断。</li>
          <li>敏感数值只经服务端授权返回，绝不编码进装饰性点阵、占位符或纯客户端状态。</li>
          <li>Passkey、TOTP、恢复码、来源凭证属于安全域行为，不是视觉状态——界面只显示授权范围与校验时间。</li>
        </ul>`,
  );

  return `<section class="sg-section">
      ${sectionHeader("sg-a11y", "08", "Accessibility", "无障碍与响应式", "无障碍写在地基里，而不是事后补。对比度、键盘、命中区、减弱动效都是交付门槛。")}
      <div class="sg-grid sg-grid--2">${touch}${focus}</div>
      <div class="sg-grid sg-grid--2">${motion}${responsive}</div>
      <div class="sg-grid">${wcag}</div>
    </section>`;
}

function renderGovernance(ctx) {
  const { meta } = ctx;

  const doList = DOS.map((item) => `<li>${esc(item)}</li>`).join("");
  const dontList = DONTS.map((item) => `<li>${esc(item)}</li>`).join("");

  const gaps = `<table class="sg-table">
      <thead><tr><th>缺口</th><th>上游契约</th><th>本产品现状</th></tr></thead>
      <tbody>${GAPS.map(
        (gap) =>
          `<tr><td class="sg-cell-token"><code>${esc(gap.name)}</code></td><td class="sg-cell-role">${esc(gap.upstream)}</td><td class="sg-cell-role">${esc(gap.status)}</td></tr>`,
      ).join("")}</tbody>
    </table>`;

  const process = `<ol class="sg-list sg-list--ordered">
      <li>先读本页与 <code>DESIGN.md</code>，再读 pinned commit 的 <code>SPEC.md</code>、<code>index.html</code>、<code>DESIGN.md</code>。</li>
      <li>需要新组件时，先按 token + 细线 + 反转 + 等宽标签 + 玻璃的规则组合，并对齐最近的既有模块的视觉密度。</li>
      <li>不引入任何第二套 CSS 框架、reset 或字体。</li>
      <li>改动 token 或组件配方后，重新生成本页：<code>pnpm design:styleguide</code>。</li>
      <li>同时验证暗色与亮色两套主题；产品工作台必须保持暗色。</li>
      <li>提交前跑 <code>pnpm test</code>（依次包含 <code>typecheck</code>、<code>design:lint</code>、单元测试）；改动过 token 或组件配方时，另外跑一次 <code>pnpm design:styleguide:verify</code>（本页渲染验收），再过一遍本文末尾的检查清单。</li>
    </ol>`;

  return `<section class="sg-section">
      ${sectionHeader("sg-governance", "09", "Governance", "治理 · 缺口 · 检查清单", "规范的寿命取决于它被更新的成本。这一页是生成物，所以更新成本只有一条命令。")}
      <div class="sg-grid sg-grid--2">
        ${specimen("正确做法", `<ul class="sg-list sg-list--do">${doList}</ul>`)}
        ${specimen("禁止项", `<ul class="sg-list sg-list--dont">${dontList}</ul>`)}
      </div>
      <div class="sg-grid">${specimen("组件缺口", gaps, { rule: "这些是上游契约里有、本产品尚未组件化的能力。补做时必须沿用上游语义，不得另起命名。" })}</div>
      <div class="sg-grid">${specimen("变更流程", process)}</div>
      <div class="sg-grid">${specimen(
        "重新生成",
        `<pre class="sg-mono-block">pnpm design:styleguide

# 读取
#   ${esc(meta.tokensSource)}
#   ${esc(meta.recipeSource)}
#   ${esc(meta.iconSource)}
#   ${esc(meta.glyphSource)}
# 产出
#   docs/design-system/styleguide.html
#   docs/design-system/tokens.json
# 生成时间 ${esc(meta.generatedAt)}</pre>`,
        { rule: "另有两条配套命令：pnpm design:lint 按 9 条规则拦住新增裸值，已接入 pnpm test 自动运行；pnpm design:styleguide:verify 在真实浏览器中断言本页的渲染结果，改动 token 或组件配方后必须手动跑一次。" },
      )}</div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

export function renderChromeCss() {
  return `/*
 * 样式指南外壳。
 * 这一层只负责承载示例，不属于设计系统本身；它同样只使用 token，
 * 因此不会引入第二套视觉语言。
 */
.sg-page { max-width: 1480px; margin: 0 auto; padding: var(--vibe-space-8) var(--vibe-space-6) var(--vibe-space-24); }
/* 组件样式声明了 display，因此 [hidden] 需要一条更具体的选择器来生效。 */
.vibe-dialog-overlay[hidden], .vibe-menu__panel[hidden] { display: none; }
.sg-header { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; justify-content: space-between; gap: var(--vibe-space-4); padding: var(--vibe-space-3) var(--vibe-space-6); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 88%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.sg-header-mark { margin: 0; color: var(--display); font-family: var(--f-display); font-size: var(--vibe-type-heading); font-variation-settings: "ROND" 100; font-weight: 500; letter-spacing: .04em; }
.sg-header-meta { margin: 3px 0 0; color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .12em; text-transform: uppercase; }
.sg-section { padding-top: var(--vibe-space-16); }
.sg-section-head { padding-bottom: var(--vibe-space-3); border-bottom: 1px solid var(--line-2); margin-bottom: var(--vibe-space-6); }
.sg-eyebrow { margin: 0; color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .14em; text-transform: uppercase; }
.sg-title { display: flex; align-items: baseline; gap: var(--vibe-space-3); margin: var(--vibe-space-2) 0 0; color: var(--display); font-family: var(--f-head); font-size: var(--vibe-type-heading); font-weight: 600; line-height: 1.2; }
.sg-index { color: var(--muted); font-family: var(--f-display); font-size: var(--vibe-type-subheading); font-variation-settings: "ROND" 100; font-weight: 500; }
.sg-note { max-width: 76ch; margin: var(--vibe-space-3) 0 0; color: var(--secondary); font-family: var(--f-ui); font-size: var(--vibe-type-body-sm); line-height: 1.7; }
.sg-grid { display: grid; gap: var(--vibe-space-3); }
.sg-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sg-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sg-grid > * { min-width: 0; }
.sg-panel { padding: var(--vibe-space-5); border: 0; border-radius: var(--r-md); background: var(--glass); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.sg-panel--wide { grid-column: 1 / -1; }
.sg-panel-head { display: flex; align-items: center; gap: var(--vibe-space-2); }
.sg-panel-title { margin: 0; color: var(--display); font-family: var(--f-head); font-size: var(--vibe-type-body); font-weight: 600; }
.sg-rule { margin: var(--vibe-space-2) 0 0; color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .04em; line-height: 1.6; }
.sg-body { margin: var(--vibe-space-3) 0 0; color: var(--secondary); font-family: var(--f-ui); font-size: var(--vibe-type-body-sm); line-height: 1.7; }
.sg-body--tight { margin-top: var(--vibe-space-2); }
.sg-muted { color: var(--muted); }
.sg-caption { margin: 0; color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .12em; text-transform: uppercase; }
.sg-badge { padding: 2px 7px; border: 1px solid var(--line-2); border-radius: var(--r-sm); color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .08em; }
.sg-badge--goal { border-style: dashed; }
.sg-badge--warn { border-color: var(--accent-text); color: var(--accent-text); }
.sg-code-inline { color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .02em; }
.sg-stage { display: block; margin-top: var(--vibe-space-4); }
.sg-stage--specimen { padding: var(--vibe-space-6) var(--vibe-space-5); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--bg); }
.sg-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--vibe-space-3); }
.sg-row--baseline { align-items: baseline; }
.sg-row--end { align-items: flex-end; }
.sg-row-between { display: flex; align-items: baseline; justify-content: space-between; gap: var(--vibe-space-4); padding: var(--vibe-space-2) 0; border-bottom: 1px solid var(--line); color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-label); }
.sg-stack { display: grid; gap: var(--vibe-space-4); }
.sg-stack--tight { gap: var(--vibe-space-2); }
.sg-kv { display: grid; gap: var(--vibe-space-2); margin: var(--vibe-space-3) 0 0; }
.sg-kv--tight { margin-top: var(--vibe-space-2); }
.sg-kv > div { display: grid; grid-template-columns: minmax(96px, 0.34fr) minmax(0, 1fr); gap: var(--vibe-space-3); align-items: baseline; padding-bottom: var(--vibe-space-2); border-bottom: 1px solid var(--line); }
.sg-kv dt { color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .1em; text-transform: uppercase; }
.sg-kv dd { margin: 0; color: var(--primary); font-family: var(--f-mono); font-size: var(--vibe-type-label); overflow-wrap: anywhere; }
.sg-table { width: 100%; border-collapse: collapse; margin-top: var(--vibe-space-3); }
.sg-table th { padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line-2); color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); font-weight: 400; letter-spacing: .1em; text-align: left; text-transform: uppercase; }
.sg-table td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--line); color: var(--primary); font-family: var(--f-ui); font-size: var(--vibe-type-caption); vertical-align: middle; }
.sg-table--data td { font-family: var(--f-mono); font-size: var(--vibe-type-label); }
.sg-cell-token { display: flex; align-items: center; gap: var(--vibe-space-2); white-space: nowrap; }
.sg-cell-token code, .sg-cell-value code { font-family: var(--f-mono); font-size: var(--vibe-type-micro); color: var(--primary); }
.sg-cell-value { white-space: nowrap; }
.sg-same { color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); }
.sg-cell-role { color: var(--secondary); font-size: var(--vibe-type-caption); line-height: 1.6; }
.sg-swatch { width: var(--vibe-space-4); height: var(--vibe-space-4); flex: 0 0 var(--vibe-space-4); border: 1px solid var(--line-2); border-radius: var(--r-sm); }
.sg-grey-sample { width: 72px; height: 44px; border: 1px solid var(--line); border-radius: var(--r-sm); }
.sg-grey-sample--1 { background: var(--display); }
.sg-grey-sample--2 { background: var(--primary); }
.sg-grey-sample--3 { background: var(--secondary); }
.sg-grey-sample--4 { background: var(--muted); }
.sg-example { padding: var(--vibe-space-4); border: 0; border-left: 3px solid var(--line-2); border-radius: var(--r-sm); background: var(--raised); }
.sg-example--dont { border-left-color: var(--accent-text); }
.sg-example-label { margin: 0 0 var(--vibe-space-3); color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .1em; text-transform: uppercase; }
.sg-fake-link { color: var(--accent); font-family: var(--f-mono); font-size: var(--vibe-type-label); text-decoration: underline; }
.sg-dark-region { padding: var(--vibe-space-5); border-radius: var(--r-md); background: var(--bg); }
.sg-dark-caption { margin: 0 0 var(--vibe-space-3); color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .14em; }
.sg-specimen-doto { margin: 0; color: var(--display); font-family: var(--f-display); font-size: min(var(--vibe-type-display-lg), 6vw); font-variation-settings: "ROND" 100; font-weight: 500; letter-spacing: -.02em; line-height: 1.1; }
.sg-specimen-ui { margin: 0; color: var(--primary); font-family: var(--f-ui); font-size: var(--vibe-type-body); line-height: 1.7; }
.sg-specimen-mono { margin: 0; color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-caption); letter-spacing: .1em; text-transform: uppercase; }
.sg-specimen-head { margin: 0; color: var(--display); font-family: var(--f-head); font-size: var(--vibe-type-heading); font-weight: 600; line-height: 1.2; }
.sg-specimen-editorial { margin: 0; color: var(--primary); font-family: var(--f-editorial); font-size: var(--vibe-type-heading); font-style: italic; }
.sg-type-sample { color: var(--primary); font-family: var(--f-ui); white-space: nowrap; }
.sg-doto-demo { margin: 0; color: var(--display); font-family: var(--f-display); font-size: var(--vibe-type-display-md); font-variation-settings: "ROND" 100; letter-spacing: .02em; }
.sg-spacing-bar { display: block; height: 10px; background: var(--display); }
.sg-radius-cell { display: grid; gap: var(--vibe-space-2); justify-items: start; }
.sg-radius-box { width: 84px; height: 56px; border: 1px solid var(--line-2); background: var(--raised); }
.sg-glyph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: var(--vibe-space-4); }
.sg-glyph-grid--icons { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); }
.sg-glyph-cell { display: grid; gap: var(--vibe-space-2); justify-items: start; color: var(--primary); }
.sg-icon-cell { display: grid; gap: var(--vibe-space-2); justify-items: start; color: var(--primary); }
.sg-dot-blocks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--vibe-space-3); }
/*
 * 独立背景区域必须自带点层：z-index:-1 的点在自身 stacking context 内位于
 * 该区域背景之上、内容之下。以下四条声明是上游「per-region dot field」配方的
 * 逐字实现，仅用于演示该配方本身；产品代码里请直接复用 body::before 或区域 ::before。
 */
.sg-dot-block { position: relative; isolation: isolate; display: grid; place-items: center; min-height: 132px; border-radius: var(--r-md); overflow: hidden; }
.sg-dot-block::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: radial-gradient(rgba(255, 255, 255, 0.42) 1.3px, transparent 1.7px); background-size: 120px 120px; mix-blend-mode: difference; }
.sg-dot-block--base { background: var(--bg); }
.sg-dot-block--inverse { background: var(--display); }
.sg-dot-block p { margin: 0; font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .08em; }
.sg-dot-block--base p { color: var(--primary); }
.sg-dot-block--inverse p { color: var(--bg); }
.sg-layer-model__cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--vibe-space-3); }
.sg-layer-card { padding: var(--vibe-space-5); border: 0; border-radius: var(--r-md); background: var(--glass); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); color: var(--secondary); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .04em; }
.sg-list { margin: var(--vibe-space-3) 0 0; padding-left: 18px; color: var(--secondary); font-family: var(--f-ui); font-size: var(--vibe-type-body-sm); line-height: 1.75; }
.sg-list li + li { margin-top: var(--vibe-space-2); }
.sg-list--do { border-left: 2px solid var(--line-2); padding-left: var(--vibe-space-4); }
.sg-list--dont { border-left: 2px solid var(--accent-text); padding-left: var(--vibe-space-4); }
.sg-list code { font-family: var(--f-mono); font-size: var(--vibe-type-label); color: var(--primary); }
.sg-mono-block { margin: var(--vibe-space-3) 0 0; padding: var(--vibe-space-4); border-radius: var(--r-sm); background: var(--bg); color: var(--primary); font-family: var(--f-mono); font-size: var(--vibe-type-label); line-height: 1.7; overflow-x: auto; white-space: pre; }
.sg-kbd { padding: 1px 5px; border: 1px solid var(--line-2); border-radius: var(--r-sm); font-family: var(--f-mono); font-size: var(--vibe-type-micro); }
.sg-inline-calendar { width: max-content; margin-top: var(--vibe-space-4); padding: var(--vibe-space-4); border: 1px solid var(--line-2); border-radius: var(--r-md); background: var(--surface); }
.sg-inline-calendar .vibe-date-field__day-grid { width: 238px; }
.sg-auth-demo { max-width: 420px; padding: var(--vibe-space-6); }
.sg-auth-title { margin: var(--vibe-space-2) 0 0; color: var(--display); font-family: var(--f-head); font-size: var(--vibe-type-subheading); font-weight: 600; }
.sg-empty { display: grid; justify-items: center; gap: var(--vibe-space-2); padding: var(--vibe-space-12) var(--vibe-space-6); border: 1px dashed var(--line-2); border-radius: var(--r-md); text-align: center; }
.sg-empty .sg-body { max-width: 42ch; }
.sg-empty-title { margin: var(--vibe-space-2) 0 0; color: var(--display); font-family: var(--f-head); font-size: var(--vibe-type-body); font-weight: 600; }
.sg-hit-outline { display: inline-flex; align-items: center; min-height: var(--vibe-control-height-compact); padding: 0 4px; outline: 1px dashed var(--line-2); outline-offset: 2px; }
.sg-slim { min-height: 24px; padding: 4px 10px; font-size: var(--vibe-type-micro); }
.sg-focus-demo:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.sg-focus-demo--input:focus-visible { outline: 0; border-color: var(--primary); }
.sg-theme-toggle { display: inline-flex; border: 1px solid var(--line-2); border-radius: var(--r-pill); overflow: hidden; }
.sg-theme-toggle button { appearance: none; padding: 6px 14px; border: 0; background: transparent; color: var(--secondary); cursor: pointer; font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .08em; }
.sg-theme-toggle button + button { border-left: 1px solid var(--line-2); }
.sg-theme-toggle button[aria-pressed="true"] { background: var(--display); color: var(--bg); }
.sg-footer { padding-top: var(--vibe-space-16); margin-top: var(--vibe-space-16); border-top: 1px solid var(--line); color: var(--muted); font-family: var(--f-mono); font-size: var(--vibe-type-micro); letter-spacing: .06em; line-height: 1.8; }
@media (max-width: 1023px) {
  .sg-grid--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 639px) {
  .sg-page { padding: var(--vibe-space-6) var(--vibe-space-4) var(--vibe-space-16); }
  .sg-grid--2, .sg-grid--3 { grid-template-columns: minmax(0, 1fr); }
  .sg-layer-model__cards, .sg-dot-blocks { grid-template-columns: minmax(0, 1fr); }
  .sg-header { padding-inline: var(--vibe-space-4); }
  .sg-header > div:first-child { min-width: 0; }
  .sg-header-meta { overflow-wrap: anywhere; }
  .sg-theme-toggle { flex: 0 0 auto; }
  .sg-title { font-size: var(--vibe-type-subheading); }
  .sg-cell-token, .sg-cell-value { white-space: normal; overflow-wrap: anywhere; }
  .sg-table { display: block; width: 100%; overflow-x: auto; }
  .sg-table th, .sg-table td { padding-right: var(--vibe-space-2); }
  .sg-type-sample { white-space: normal; }
  .sg-inline-calendar { width: 100%; }
  .sg-inline-calendar .vibe-date-field__day-grid { width: 100%; }
}`;
}

/**
 * Fixed-position overlays live outside the flow so their real positioning
 * behaviour is exercised rather than simulated.
 */
export function renderOverlays() {
  return `<div aria-labelledby="sg-dialog-title" aria-modal="true" class="vibe-dialog-overlay" data-vibe-component="modal" hidden id="sg-dialog-overlay" role="dialog">
      <section class="vibe-dialog">
        <header class="vibe-dialog__header">
          <div class="vibe-dialog__heading">
            <p class="vibe-dialog__eyebrow">Danger zone</p>
            <h2 id="sg-dialog-title">删除来源数据</h2>
          </div>
        </header>
        <div class="vibe-dialog__body">
          <p class="vibe-dialog__copy">将永久删除该来源及其全部历史快照。断开来源会保留历史，删除不会。</p>
        </div>
        <footer class="vibe-dialog__footer">
          <button class="vibe-button vibe-button--text" data-sg-close-dialog type="button">取消</button>
          <button class="vibe-button vibe-button--primary" data-sg-dialog-primary type="button" data-sg-close-dialog>永久删除</button>
        </footer>
      </section>
    </div>`;
}

export function renderSections(ctx) {
  return [
    renderOverview(ctx),
    renderColor(ctx),
    renderTypography(ctx),
    renderGeometry(ctx),
    renderDotLanguage(ctx),
    renderBackground(ctx),
    renderComponents(ctx),
    renderStates(ctx),
    renderAccessibility(ctx),
    renderGovernance(ctx),
  ].join("\n");
}

export function renderScript() {
  return `(function () {
  var root = document.documentElement;
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-sg-theme]"));
  var stored = null;
  try { stored = window.localStorage.getItem("sg-theme"); } catch (error) { stored = null; }
  if (stored === "light" || stored === "dark") root.dataset.theme = stored;

  function paint() {
    var current = root.dataset.theme || "dark";
    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.sgTheme === current));
    });
  }
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      root.dataset.theme = button.dataset.sgTheme;
      try { window.localStorage.setItem("sg-theme", button.dataset.sgTheme); } catch (error) {}
      paint();
    });
  });
  paint();

  var dialog = document.getElementById("sg-dialog-overlay");
  var openDialog = document.querySelector("[data-sg-open-dialog]");
  var closeDialog = document.querySelector("[data-sg-close-dialog]");
  if (dialog && openDialog) {
    var lastFocus = null;
    var show = function () {
      lastFocus = document.activeElement;
      dialog.hidden = false;
      document.body.style.overflow = "hidden";
      var first = dialog.querySelector("[data-sg-dialog-primary]");
      if (first) first.focus();
    };
    var hide = function () {
      dialog.hidden = true;
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };
    openDialog.addEventListener("click", show);
    if (closeDialog) closeDialog.addEventListener("click", hide);
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) hide();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !dialog.hidden) hide();
    });
  }

  Array.prototype.slice.call(document.querySelectorAll("[data-sg-menu]")).forEach(function (menu) {
    var trigger = menu.querySelector(".vibe-menu__trigger");
    var panel = menu.querySelector(".vibe-menu__panel");
    if (!trigger || !panel) return;
    trigger.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", function (event) {
      if (!menu.contains(event.target) && !panel.hidden) {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  });

  var codeInput = document.getElementById("sg-code");
  if (codeInput) {
    var slots = Array.prototype.slice.call(document.querySelectorAll("[data-sg-slot]"));
    var control = codeInput.closest(".vibe-verification-code__control");
    codeInput.addEventListener("input", function () {
      var digits = codeInput.value.replace(/[^0-9]/g, "").slice(0, slots.length);
      codeInput.value = digits;
      slots.forEach(function (slot, index) {
        slot.textContent = digits[index] || "";
      });
    });
    codeInput.addEventListener("focus", function () {
      if (control) control.classList.add("is-focused");
      var active = slots[Math.min(codeInput.value.length, slots.length - 1)];
      slots.forEach(function (slot) { slot.classList.remove("is-active"); });
      if (active) active.classList.add("is-active");
    });
    codeInput.addEventListener("blur", function () {
      if (control) control.classList.remove("is-focused");
      slots.forEach(function (slot) { slot.classList.remove("is-active"); });
    });
  }

  var counters = Array.prototype.slice.call(document.querySelectorAll(".vibe-live-counter[data-sg-count]"));
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  counters.forEach(function (counter) {
    var target = counter.dataset.counterTarget || "";
    var parsed = /^\\d[\\d,]*(?:\\.\\d+)?$/.exec(target);
    if (!parsed || reduced) {
      counter.dataset.counterState = "complete";
      return;
    }
    var hasGroups = target.indexOf(",") !== -1;
    var decimals = target.indexOf(".") === -1 ? 0 : target.length - target.indexOf(".") - 1;
    var numeric = Number(target.replace(/,/g, ""));
    var format = function (value) {
      var text = value.toFixed(decimals);
      if (!hasGroups) return text;
      var parts = text.split(".");
      parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
      return parts.join(".");
    };
    var measured = false;
    var start = function () {
      if (measured) return;
      measured = true;
      var startedAt = performance.now();
      var duration = 1200;
      counter.dataset.counterState = "running";
      var step = function (now) {
        var progress = Math.min((now - startedAt) / duration, 1);
        var eased = progress < 0.5
          ? 4 * Math.pow(progress, 3)
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        counter.textContent = format(numeric * eased);
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        counter.textContent = target;
        counter.dataset.counterState = "complete";
      };
      window.requestAnimationFrame(step);
    };
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        start();
      }, { threshold: 0.6 });
      observer.observe(counter);
    } else {
      start();
    }
  });
})();`;
}
