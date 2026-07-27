# Personal Asset Dashboard Design System

Status: active baseline

Reference: [Vibe-Nothing-UI-Design](https://github.com/wangbh030722/vibe-nothing-ui-design)

This project uses the reference as an independent, Nothing-inspired visual source. It does not ship Nothing proprietary fonts or brand assets. Doto, Space Grotesk, and Space Mono are loaded through `next/font/google`, localized into the Next.js build, and exposed as CSS font variables.

## 1. Visual theme and atmosphere

The dashboard is a precise personal instrument: monochrome, quiet, compact, and recognizably dot-matrix. It combines Nothing-style round-dot display typography with Bloomberg-style financial alignment and the existing flexible card composition.

- Visual thesis: black, grey, and white carry hierarchy; round dots carry identity; signal red communicates an exceptional state only.
- Content plan: orient with identity and freshness, show the total, compare sources, then expose holding detail.
- Interaction thesis: selection inverts black and white, card borders brighten without floating, refresh and valuation state use stepped segments. Card resize and reorder previews use a signal-red solid outline covering the complete target footprint.

## 2. Color palette and roles

The exact neutral and signal values follow the supplied reference repository so screenshots and components remain comparable.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| Canvas | `#F5F5F5` | `#000000` | Page background |
| Surface | `#FFFFFF` | `#111111` | Menus and dialogs |
| Raised | `#F0F0F0` | `#1A1A1A` | Active rows and secondary panels |
| Line | `#E8E8E8` | `#222222` | Quiet separators |
| Line strong | `#CCCCCC` | `#333333` | Control outlines |
| Primary ink | `#1A1A1A` | `#E8E8E8` | Body and control text |
| Display ink | `#000000` | `#FFFFFF` | Headlines and large numbers |
| Secondary ink | `#666666` | `#999999` | Labels and supporting data |
| Muted ink | `#999999` | `#666666` | Disabled and placeholder text |
| Signal red | `#D71921` | `#D71921` | Needs attention, stale or failed |
| Success | `#4A9E5C` | `#62B873` | Fresh or completed value |
| Warning | `#9A6D00` | `#D4A843` | Incomplete valuation |
| Error | `#D71921` | `#FF5A52` | Failed synchronization |

Rules:

- Signal red appears on at most two semantic elements in one viewport.
- Selected controls use display/canvas inversion, never signal red.
- Gradients, decorative shadows, and colored marketing accents are prohibited.
- Sensitive-data placeholders use only safe neutral geometry. Their dots never encode real values.

## 3. Typography rules

| Role | Family | Size | Weight | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Display XL | Doto | 48px | 500 | `-0.02em` | Total asset amount |
| Display L | Doto | 36–48px | 500 | `-0.01em` | Locked state and rare secondary hero |
| Headline | Space Grotesk, PingFang SC | 18–24px | 500 | normal | Card and dialog titles |
| UI body | Space Grotesk, PingFang SC | 14–16px | 400 | normal | Chinese descriptions and controls |
| Data | Space Mono | 11–48px | 400 or 700 | normal | Source totals, prices, quantities, timestamps, tables |
| Label | Space Mono | 10–11px | 400 or 700 | `0.08em` | Uppercase labels and statuses |

- Use Doto only for the total-asset hero and locked-state instrument. Source totals, changes, dates, timestamps, table cells, and compact list data remain Space Mono for scanning accuracy.
- Data columns use Space Mono with tabular numerals and right alignment.
- Chinese body copy stays in a readable sans-serif fallback and uses line-height 1.7.
- Negative tracking is never applied to Chinese text.
- Units such as USD, CNY, ETH, and `%` remain compact Space Mono beside the number.
- Font variables are attached to the root `html` element so derived aliases resolve correctly; visual acceptance must verify computed font families, not only CSS declarations.

## 4. Component styling

### Buttons

- Standard compact radius: 8px. Primary, secondary, and segmented buttons use an explicit pill shape.
- Primary: display ink fill with canvas text.
- Secondary: transparent with one strong hairline.
- Hover: opacity `0.8`. Press: opacity `0.64` and translate `1px`.
- Minimum target: 44px by 44px. Focus uses a 2px display-ink outline.

### Cards and modules

- Radius: 12px. Padding: 20px to 24px. Gap: 12px.
- Use stepped solid surfaces, not generic drop shadows.
- Asset cards have no decorative corner brackets.
- Each source card exposes provider code, live/stale signal, segmented valuation completeness, indexed holdings and a separate control deck.
- The locked homepage uses an open, asymmetric two-column composition: owner access on the left and a non-sensitive mechanical lock instrument on the right. It does not imitate the asset grid.
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

- Desktop: three logical columns, 12px gaps, maximum content width 1280px.
- Medium: two logical columns.
- Phone: one column, 16px page inset.
- Width resizing snaps to the one, two, or three-column grid and shows an independent red outline before committing; card height always follows content and is never stored as layout data. Reordering uses the same outline at the destination with the source card's complete span and current content height.
- Starting a card on a new row changes only its grid start line; it must never reset or override the card's one, two, or three-column span.
- Spacing scale: `4, 8, 16, 24, 32, 48, 64, 96`.
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
- Keep Chinese reading text in Space Grotesk plus CJK fallback.
- Reserve red for stale, failed, live, or needs-attention states.
- Use full-circle dots for all dot-matrix glyphs.
- Keep the locked login page visually distinct from the authenticated asset dashboard.

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

Quick tokens: canvas `#F5F5F5/#000000`, surface `#FFFFFF/#111111`, display `#000000/#FFFFFF`, primary `#1A1A1A/#E8E8E8`, signal `#D71921`, radius `8px/12px`, gap `12px`.

- Create a total-asset hero without a surrounding card. Use a Space Mono uppercase label, a 54–84px Doto amount, a compact Space Mono currency unit, and one bottom rule before source cards.
- Create a source card with a Space Mono provider label, an 18px Space Grotesk headline, a 34–48px Space Mono total, a 12-step valuation meter, indexed rows, quiet separators, and 44px controls.
- Create a holdings table with left-aligned identity, right-aligned tabular numeric columns, 12px Space Mono data, uppercase headers, and quiet row separators. Do not use zebra rows.
- Create a stale state using one 7px full-circle signal-red dot, a Space Mono label, the last-success timestamp, and visible text stating `过期数据`. Do not color the entire card.
- Create a locked owner-login composition with no asset symbol, amount, source identity, timestamp, placeholder card, or simulated portfolio layout. The only expressive element is the Doto `LOCKED` instrument.
