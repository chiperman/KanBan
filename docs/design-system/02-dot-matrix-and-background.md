# 02 · 点阵语言与背景点场

这两件事是这套系统的签名特征，也是最容易做错的地方。

---

## 1. 点阵语言

点阵是系统的母语。数字、图标与标点共用同一种圆点单元。

### 1.1 数字

**每个独立数字都用点阵显示字体承载**：日历日期、页码、步骤序号、计数、百分比、仪表读数。

- 数字的**符号与它同属一个点阵单元**：`78%`、`73%` 整体用 Doto 排版，不要只把数字点阵化而让 `%` 退回等宽字体。
- 字母单位（GB、K、MB、USD）保持小号等宽字体，不点阵化。
- 例外：数据表格与极小号的行内计数可以使用等宽字体。

### 1.2 图标

- **9×9 点阵位图**：`display: grid` + `grid-template-columns: repeat(9, 1fr)`，每个点亮的格子是一个**完整圆点**（`border-radius: 50%`）。
- **尺寸由单一变量驱动**：本产品为 `--vibe-dot-icon-size`（上游为 `--gs`），点间隙按尺寸的 1/20 等比缩放。改一个变量即可整枚放大，点间距自动跟随，不会被拉变形。
- **绝不用 `mask` 或 `clip-path` 裁切点阵**——那会把圆点切成半圆。
- 字形比特直接来自 `src/ui/vibe/vibe-dot-icon.tsx`，当前共 8 枚：`check` `computer` `error` `gear` `key` `lock` `moon` `sun`。
- **功能性小图标**（按钮、输入框、导航内）仍然使用 1.5px 线形 SVG（`<VibeIcon>`，22px 视口、圆端圆角、`currentColor`），以保证可读性。线形图标**绝不填充、绝不多色**。

### 1.3 25×25 字形矩阵（未实现）

上游还有一层设备级字形矩阵：25×25 可寻址网格、圆形遮罩（四角无点）、白色圆点、暗 LED 底纹。**本产品当前没有该场景，因此未实现。** 一旦需要设备级点阵插画，必须按上游规范生成（用几何函数而非手工绘制点阵位图），不得自行发明。

### 1.4 点阵标点（未实现）

上游在点阵语境下用圆点单元承载 `:` `·` `…`（`.colon` / `.pdot` / `.ellip`，直径由 `--pxd` 控制），**不使用字体字形**。本产品当前没有点阵排字场景，因此未实现。一旦出现时钟、计时或点阵标题，必须补齐这一层，不可直接写字形标点。

---

## 2. 背景点场

Nothing 的签名背景：一层**非常稀疏的圆点**。

### 2.1 三层模型

> 从下到上：**Background → Dots → Card**

点层位于卡片之下；卡片浮在其上并**盖住**点。点只在卡片之间的缝隙与页面边缘可见，**卡片表面不出现点**。

### 2.2 局部反色（核心）

点不是"每套主题一种固定颜色"，而是取**它当前所在表面的局部反色**：暗底上更亮，亮底上更暗。一片连续的点场跨过明暗两侧，各自都读得通。

实现方式是**半透明白点 + `mix-blend-mode: difference`**，靠混合自动反色。**不要为每个主题各写一种点色。**

### 2.3 实现约束

```css
/* 页面级 —— 见 src/app/vibe-components.css 的 body::before */
body::before {
  content: "";
  position: fixed;
  z-index: -1;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(rgba(255, 255, 255, 0.42) 1.3px, transparent 1.7px);
  background-size: 120px 120px;
  background-attachment: fixed;
  mix-blend-mode: difference;
}
```

| 约束 | 要求 | 理由 |
|---|---|---|
| 尺寸 | 点直径约 **1.3px**、间距约 **120px** | 凑近能看见，但从不与内容竞争。密于约 64px 即为错误 |
| 混合 | 必须 `mix-blend-mode: difference` + 半透明白点 | 用一个规则同时满足明暗两套主题的局部反色 |
| 层级 | `z-index: -1` | 必须在卡片之下 |
| 对齐 | `background-attachment: fixed` | 整页对齐为一张视口网格，跨模块连续 |

### 2.4 独立区域必须自带点层

一个自带背景的区域（例如永远保持暗色的工作台容器）会**把自己的底面画在页面点层之上**，导致点在该区域内完全不可见。此时该区域必须建立自己的点层：

```css
.region {
  position: relative;
  isolation: isolate;
}
.region::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: radial-gradient(rgba(255, 255, 255, 0.42) 1.3px, transparent 1.7px);
  background-size: 120px 120px;
  mix-blend-mode: difference;
}
```

关键在于 `isolation: isolate` 让该区域成为独立层叠上下文：区域自身背景在最底，点层（`z-index: -1`）在其上，内容在最上，于是 region 内的点同样获得局部反色。

> 这是上游 "per-region dot field" 的规范做法。`styleguide.html` 的「背景点场」章节就是用这段配方渲染的——它可以作为该配方的可视化验证。

### 2.5 常见错误

| 错误 | 后果 |
|---|---|
| 只给卡片加 `background` 却忘了点层在 `z-index: -1` | 不透明区域内的点完全消失 |
| 为浅色主题另写一层深色点 | 两套规则容易不同步；跨明暗边界的连续性丢失 |
| 把 `background-attachment` 设成 `scroll` | 滚动时点场与页面脱开，模块之间失去同一张网格 |
| 把点铺到前景内容上 | 前景可读性下降，违反"点是背景"的定位 |
| 用 `mask` / `clip-path` 做点阵图标 | 圆点被裁成半圆 |
