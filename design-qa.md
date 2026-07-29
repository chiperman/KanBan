# Verification Code design QA

## Comparison target

- Source visual truth: `~/.codex/visualizations/2026/07/29/019facea-4557-7210-93f4-e976b10039b0/verification-code-implementation/11-source-dark-1265x705.png`
- Implementation screenshot: `~/.codex/visualizations/2026/07/29/019facea-4557-7210-93f4-e976b10039b0/verification-code-implementation/12-implementation-dark-1265x705.png`
- Side-by-side comparison: `~/.codex/visualizations/2026/07/29/019facea-4557-7210-93f4-e976b10039b0/verification-code-implementation/17-side-by-side-design-qa-final.png`
- Source revision: `wangbh030722/vibe-nothing-ui-design@46661e55ae04537215a229be49f2ac1bd37a4255`, module 43.
- State: dark theme, empty verification code, unfocused.
- Browser viewport override: 1280 × 720 CSS px, device density 1.
- Source pixels: 1253 × 705 because the upstream reference page reserves native scrollbars.
- Implementation pixels: 1280 × 720.
- Normalization: the comparison canvas scales both full views to 580 × 326 and uses focused 580 × 250 crops around the verification controls.

## Full-view comparison

The verification control now reads as part of the pinned Nothing UI language: monochrome token colors, 6px technical radii, 1px control hairlines, Doto numerals, and 8px desktop rhythm. The surrounding KanBan authentication composition intentionally remains product-native.

The implementation uses six cells instead of the four-cell reference example because TOTP is a six-digit security contract. This is an expected product adaptation, not design drift.

## Focused comparison

- Fonts and typography: each digit uses Doto at 22px and weight 500; the label remains the existing 9px uppercase Geist Mono role.
- Spacing and layout rhythm: desktop cells are 40 × 50px with 8px gaps; at 320px they adapt to 36 × 50px with 4px gaps and do not create horizontal overflow.
- Colors and tokens: borders use `--line-2`, focus uses `--primary`, digits use `--display`, and errors use `--error`. No raw component color was introduced.
- Image quality and assets: the component contains no image or icon asset, so there is no raster/vector fidelity gap.
- Copy and content: the existing Chinese TOTP instructions, labels, actions, and security notices are unchanged.
- Accessibility: one native labelled input retains `autocomplete="one-time-code"`, paste/autofill, form submission, invalid/error association, disabled state, and error-focus behavior; the six visible cells are presentation only.

## Comparison history

### Pass 1

- Finding: [P2] selecting the transparent native value at 320px could expose a browser selection highlight above the visible cells.
- Fix: set the overlaid native input to `opacity: 0`; focus and error state remain visible through the six presentation cells.
- Post-fix evidence: `~/.codex/visualizations/2026/07/29/019facea-4557-7210-93f4-e976b10039b0/verification-code-implementation/04-filled-selected-mobile-320-dark.png` shows all six digits with no leaked selection text and no horizontal overflow.

### Pass 2

- No actionable P0, P1, or P2 mismatch remains in the desktop dark, desktop light, 320px mobile, empty, filled, selected, paste/autofill, and backspace states checked.

## Verification

- Primary interactions checked: whole-code fill/paste, digit rendering, Backspace removal, empty state, selected state, disabled and invalid contracts through focused E2E coverage.
- Browser console: no errors or warnings.
- Automated evidence: `pnpm typecheck`, `pnpm build`, and all 12 tests in `e2e/recovery-session-lock.spec.ts` passed; the post-fix TOTP login test also passed independently.

## Follow-up polish

No P3 follow-up is required for this scoped component change.

final result: passed
