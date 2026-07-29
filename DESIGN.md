# Personal Asset Dashboard design system

Status: pinned Vibe-Nothing-UI baseline integrated

## 1. Canonical source and traceability

KanBan uses [wangbh030722/vibe-nothing-ui-design](https://github.com/wangbh030722/vibe-nothing-ui-design) as its only visual design system.

The project pins upstream commit [`46661e55ae04537215a229be49f2ac1bd37a4255`](https://github.com/wangbh030722/vibe-nothing-ui-design/commit/46661e55ae04537215a229be49f2ac1bd37a4255). The complete local snapshot and its license record live at [`vendor/vibe-nothing-ui-design/`](vendor/vibe-nothing-ui-design/UPSTREAM.md).

Design truth is resolved in this order:

1. [`vendor/vibe-nothing-ui-design/SPEC.md`](vendor/vibe-nothing-ui-design/SPEC.md) — normative implementation contract.
2. [`vendor/vibe-nothing-ui-design/index.html`](vendor/vibe-nothing-ui-design/index.html) — visual source of truth.
3. [`vendor/vibe-nothing-ui-design/DESIGN.md`](vendor/vibe-nothing-ui-design/DESIGN.md) — rationale and design decisions.
4. [`vendor/vibe-nothing-ui-design/css/tokens.css`](vendor/vibe-nothing-ui-design/css/tokens.css) and [`css/nothing-ui.css`](vendor/vibe-nothing-ui-design/css/nothing-ui.css) — implementation evidence.
5. This file — KanBan integration rules only.

If this file conflicts with the pinned upstream specification on a visual decision, upstream wins. Product security, privacy, accessibility, and read-only-domain constraints remain mandatory and must be adapted without inventing a second visual language.

## 2. Runtime integration

- Fonts are self-hosted from `public/fonts/nothing-open/`: Doto, Geist, Geist Mono, and Newsreader Italic.
- Runtime tokens use upstream names and values: `--bg`, `--surface`, `--raised`, `--line`, `--line-2`, `--muted`, `--secondary`, `--primary`, `--display`, `--accent`, status colors, glass colors, font roles, and radii.
- Visual semantics use upstream token names directly. KanBan-only `--vibe-*` tokens are limited to the documented 4px layout/type scale and must not redefine color, font-role, radius, or state semantics.
- Upstream `js/nothing-ui.js` is not executed. It is a vanilla-JavaScript showcase implementation; KanBan implements the same observable behavior in React.
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

## 4. Migration status

The repository is being migrated in stages so existing functional changes are not overwritten.

- [x] Pin and vendor upstream specification, implementation evidence, licenses, and fonts.
- [x] Make the upstream repository traceable from the project design entrypoint.
- [x] Replace the runtime font and token foundation with the pinned upstream values.
- [x] Complete the React Vibe module for surfaces, controls, dot glyphs, status, metrics, and segmented data instruments under `src/ui/vibe/`.
- [x] Migrate owner login, Passkey setup, and TOTP recovery to the React Vibe module.
- [x] Migrate the asset overview, source modules, holdings, and control deck.
- [x] Migrate dialogs, command navigation, source onboarding, and layout-editing states.
- [x] Remove legacy design aliases and the old `nothing-system.css` implementation.
- [x] Complete desktop, tablet, phone, light, dark, keyboard, and reduced-motion browser acceptance.

Migration status must be reported honestly: vendoring the upstream files does not mean a page has been visually migrated.

## 5. Updating upstream

The exact update procedure, integrity hashes, license record, and pinned revision are documented in [`vendor/vibe-nothing-ui-design/UPSTREAM.md`](vendor/vibe-nothing-ui-design/UPSTREAM.md).

Every update must include:

1. the old and new upstream commit;
2. reviewed upstream diffs;
3. refreshed integrity hashes;
4. React adapter changes when required;
5. focused browser acceptance evidence;
6. an explicit statement of pages that remain unmigrated.
