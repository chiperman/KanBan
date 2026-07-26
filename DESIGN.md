# Personal Asset Dashboard Design System

Status: active baseline

Reference: [Vibe-Nothing-UI-Design](https://github.com/wangbh030722/vibe-nothing-ui-design)

This project uses the reference as an independent, Nothing-inspired visual source. It does not ship Nothing proprietary fonts or brand assets. The bundled Doto, Geist, and Geist Mono files remain under SIL OFL 1.1.

## 1. Visual theme and atmosphere

The dashboard is a precise personal instrument: monochrome, quiet, compact, and recognizably dot-matrix. It combines Nothing-style round-dot display typography with Bloomberg-style financial alignment and the existing flexible card composition.

- Visual thesis: black, grey, and white carry hierarchy; round dots carry identity; signal red communicates an exceptional state only.
- Content plan: orient with identity and freshness, show the total, compare sources, then expose holding detail.
- Interaction thesis: selection inverts black and white, cards move at most 2px on hover, refresh state advances through stepped dots.

## 2. Color palette and roles

The exact neutral and signal values follow the supplied reference repository so screenshots and components remain comparable.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| Canvas | `#F2F2F2` | `#000000` | Page background |
| Surface | `#FFFFFF` | `#0C0C0C` | Menus and dialogs |
| Raised | `#EDEDED` | `#171717` | Active rows and secondary panels |
| Line | `#E2E2E2` | `#262626` | Quiet separators |
| Line strong | `#CFCFCF` | `#3A3A3A` | Control outlines |
| Primary ink | `#1C1C1C` | `#EDEDED` | Body and control text |
| Display ink | `#000000` | `#FFFFFF` | Headlines and large numbers |
| Secondary ink | `#585A5A` | `#8C8C8C` | Labels and supporting data |
| Muted ink | `#9A9A9A` | `#5A5A5A` | Disabled and placeholder text |
| Signal red | `#D71921` | `#D71921` | Needs attention, stale, failed, live |
| Success | `#3D8B4A` | `#7BE38A` | Fresh or completed value |
| Warning | `#9C6B00` | `#F2C94C` | Incomplete valuation |
| Error | `#D23B30` | `#FF5247` | Failed synchronization |

Rules:

- Signal red appears on at most two semantic elements in one viewport.
- Selected controls use display/canvas inversion, never signal red.
- Gradients, decorative shadows, and colored marketing accents are prohibited.
- Sensitive-data placeholders use only safe neutral geometry. Their dots never encode real values.

## 3. Typography rules

| Role | Family | Size | Weight | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Display XL | Doto | 48px | 500 | `-0.02em` | Total asset amount |
| Display L | Doto | 32px | 500 | `-0.01em` | Source totals and major change |
| Display S | Doto | 14px | 500 | `0.04em` | Module numbers and compact counters |
| Headline | Geist, PingFang SC | 18px | 600 | normal | Card and dialog titles |
| UI body | Geist, PingFang SC | 13px | 400 | normal | Chinese descriptions and controls |
| Data | Geist Mono | 11px | 400 or 500 | normal | Prices, quantities, timestamps, tables |
| Label | Geist Mono | 9px | 500 | `0.12em` | Uppercase labels and statuses |

- Use Doto for hero totals, primary changes, and module counters. Dates, timestamps, table cells, and compact list data remain Geist Mono for scanning accuracy.
- Data columns use Geist Mono with tabular numerals and right alignment.
- Chinese body copy stays in a readable sans-serif fallback and uses line-height 1.7.
- Negative tracking is never applied to Chinese text.
- Units such as USD, CNY, ETH, and `%` remain compact Geist Mono beside the Doto number.

## 4. Component styling

### Buttons

- Standard radius: 6px. Circular icon buttons are the only pill-shaped buttons.
- Primary: display ink fill with canvas text.
- Secondary: transparent with one strong hairline.
- Hover: opacity `0.8`. Press: opacity `0.64` and translate `1px`.
- Minimum target: 40px by 40px. Focus uses a 2px display-ink outline.

### Cards and modules

- Radius: 8px. Padding: 20px to 24px. Gap: 12px.
- Use stepped solid surfaces, not generic drop shadows.
- Ordinary cards have no decorative corner brackets.
- Restricted cards may use a safe 9×9 dot field, but dots stay behind content.
- Total overview is the dominant full-width module. Source cards remain compact and equal in density, not forced to equal height.

### Inputs and selectors

- Radius: 6px. Transparent or canvas background with a 1px strong line.
- Focus changes only the outline color. No glow and no signal-red focus state.
- Labels stay above fields and never become placeholders.

### Tables and financial data

- No zebra rows. Use 1px quiet separators.
- Text columns align left. Numeric columns align right with at least 16px separation.
- Missing price remains `未估值`; it is never replaced with zero.

### Status

- Fresh: neutral by default; optional success value only when useful.
- Stale or incomplete: signal text plus a single round dot.
- Failed: error value and concise source-specific explanation.
- Status is never communicated through color alone.

## 5. Layout principles

- Desktop: three logical columns, 12px gaps, maximum content width 1180px.
- Medium: two logical columns.
- Phone: one column, 16px page inset.
- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 64`.
- The first viewport prioritizes identity/freshness, total assets, then source state.
- Dashboard surfaces stay utility-first. There is no marketing hero.

## 6. Depth and elevation

- Level 0: canvas.
- Level 1: card surface, one lightness step above canvas.
- Level 2: raised controls, selected rows, and nested summaries.
- Level 3: dialog surface with an overlay; no large drop shadow.
- Hairlines separate data. Background steps separate surfaces.

## 7. Do and do not

Do:

- Use Doto where a number is the visual subject.
- Keep Chinese reading text in Geist plus CJK fallback.
- Reserve red for stale, failed, live, or needs-attention states.
- Use full-circle dots for all dot-matrix glyphs.
- Keep visitor placeholders structurally similar but semantically empty.

Do not:

- Apply a pixel font to paragraphs or long Chinese labels.
- Use gradients, glow, glass blur, or generic card shadows.
- Add proprietary NDot or NType assets.
- Add trading, wallet connection, signing, or notification affordances.
- Use dot density as decoration on every surface.

## 8. Responsive behavior

- Breakpoints: 1024px and 640px, preserving existing card order.
- Desktop and medium layouts retain one, two, and three-column spans.
- Phone controls wrap without reducing the 40px hit target.
- Detail tables scroll horizontally rather than compressing numeric columns.
- `prefers-reduced-motion` disables card movement and stepped refresh animation.
- Visual acceptance covers 1280px, 800px, and 375px in light and dark themes.

## 9. Agent prompt guide

Quick tokens: canvas `#F2F2F2/#000000`, surface `#FFFFFF/#0C0C0C`, display `#000000/#FFFFFF`, primary `#1C1C1C/#EDEDED`, signal `#D71921`, radius `6px/8px`, gap `12px`.

- Create a total-asset module on the surface token, radius 8px, padding 24px. Use a 9px Geist Mono uppercase label at `0.12em`, a 48px Doto amount at weight 500, and an 11px Geist Mono currency unit. Do not add a shadow.
- Create a source card with a 9px Geist Mono provider label, an 18px Geist headline, a 32px Doto total, 1px quiet row separators, and a 40px secondary action with a 6px radius.
- Create a holdings table with left-aligned identity, right-aligned tabular numeric columns, 11px Geist Mono data, 9px uppercase headers, and 1px quiet row separators. Do not use zebra rows.
- Create a stale state using one 7px full-circle signal-red dot, an 11px Geist Mono label, the last-success timestamp, and visible text stating `过期数据`. Do not color the entire card.
- Create a restricted placeholder using neutral dots behind safe copy, no real symbol, amount, source identity, or timestamp, with a 40px inversion button for authentication.
