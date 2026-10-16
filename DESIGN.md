# Personal Asset Dashboard design system

Status: project-native implementation referencing a pinned Vibe-Nothing-UI revision

## 1. External design reference

KanBan uses [wangbh030722/vibe-nothing-ui-design](https://github.com/wangbh030722/vibe-nothing-ui-design) as an external visual reference, not as a vendored runtime dependency.

The reviewed reference revision is [`46661e55ae04537215a229be49f2ac1bd37a4255`](https://github.com/wangbh030722/vibe-nothing-ui-design/commit/46661e55ae04537215a229be49f2ac1bd37a4255). Before every UI, interaction, or visual-design task, read the pinned GitHub files in this order:

1. [`SPEC.md`](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/SPEC.md) — normative visual rules.
2. [`index.html`](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/index.html) — rendered component and composition evidence.
3. [`DESIGN.md`](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/DESIGN.md) — rationale, tokens, and design decisions.
4. [`css/tokens.css`](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/css/tokens.css) and [`css/nothing-ui.css`](https://github.com/wangbh030722/vibe-nothing-ui-design/blob/46661e55ae04537215a229be49f2ac1bd37a4255/css/nothing-ui.css) — implementation evidence.

This file is KanBan's adopted design contract. Upstream changes do not apply automatically. Product security, privacy, accessibility, financial truth, and read-only constraints take precedence and must be adapted without creating a second visual language.

## 2. Runtime integration

- Fonts are self-hosted from `public/fonts/nothing-open/`: Doto, Geist, Geist Mono, and Newsreader Italic.
- Runtime tokens use upstream names and values: `--bg`, `--surface`, `--raised`, `--line`, `--line-2`, `--muted`, `--secondary`, `--primary`, `--display`, `--accent`, status colors, glass colors, font roles, and radii.
- Visual semantics use upstream token names directly. KanBan-only `--vibe-*` tokens are limited to the documented 4px layout/type scale and must not redefine color, font-role, radius, or state semantics.
- Upstream JavaScript is reference evidence only and is not copied or executed. KanBan implements the adopted behavior in React.
- Business pages consume the React design module under `src/ui/vibe/` instead of duplicating upstream class recipes in each page.
- `src/app/product-layout.css` is the product layout/interaction adapter. It consumes the upstream contract and is not a second design system.

## 3. Product adapter rules

These rules adapt the upstream system without changing its visual contract:

- Chinese body text falls back from Geist to `PingFang SC`, `Noto Sans SC`, and system sans-serif.
- Financial values retain full precision, tabular alignment, explicit currency units, and truthful unavailable states.
- Missing valuation is displayed as `未估值`; it is never converted to zero.
- Sensitive asset values remain server-authorized and are never encoded into decorative dots, placeholders, or client-only state.
- Passkey, TOTP, recovery, source credentials, and browser-session boundaries remain security-domain behavior, not visual state.
- Interactive controls retain accessible names, keyboard operation, visible focus, and at least a 40px hit target even when the visible control uses the upstream 6px technical radius.
- Reduced-motion preferences disable nonessential motion while preserving state communication.

## 4. Project implementation seam

- `DESIGN.md` defines the adopted project contract and upstream reference revision.
- `src/app/design-tokens.css` owns runtime tokens and font loading.
- `src/app/vibe-components.css` owns shared visual recipes.
- `src/app/product-layout.css` owns KanBan-specific layout and interaction adaptation.
- `src/ui/vibe/` is the React interface consumed by product pages.
- `public/fonts/nothing-open/` contains required runtime fonts and their OFL licenses.
- `docs/design-system/` expands this contract into the normative specification set, a generated
  `styleguide.html` living styleguide, and a register of known deviations. It is governed by
  `docs/design-system/06-governance.md`, regenerated with `pnpm design:styleguide`, and enforced by
  `pnpm design:lint` (existing deviations are baselined; new raw values fail). The lint runs as part
  of `pnpm test`, so a raw value introduced by new code fails the default gate.

The upstream repository must not be copied wholesale into this project. The local React module and styles are the maintained implementation.

## 5. Reference update procedure

Changing the pinned reference revision requires an explicit design task:

1. compare the current and proposed upstream commits on GitHub;
2. review changes to the specification, visual example, tokens, recipes, and licenses;
3. update the pinned links in this file and `AGENTS.md` when necessary;
4. adapt the local React module and runtime styles deliberately;
5. run focused browser acceptance and the full relevant regression suite;
6. record the old and new reference commits in the resulting commit message.

Third-party attribution is retained in [`docs/third-party-notices.md`](docs/third-party-notices.md). The current upstream `main` branch is never treated as an implicit update.
