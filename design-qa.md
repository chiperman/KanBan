# Owner locked page computer flow design QA

## Comparison target

- Source visual truth: `/var/folders/hh/cg4z8pk92z59lqmtrjqb385r0000gn/T/codex-clipboard-2fff8863-afd0-459d-99d3-800b2e8e8da6.png`
- Final implementation screenshot: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v18-rounded-keyboard-login.png`
- Full comparison: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v18-full-comparison.png`
- Computer comparison: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v17-computer-comparison.png`
- Keyboard comparison: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v18-keyboard-comparison.png`
- Login comparison: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v18-login-comparison.png`
- Route comparison: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v17-route-comparison.png`
- Active-route evidence: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v17-routes-active.png`
- Animation phases: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v16-animation-phases.png`
- Mobile evidence: `~/.codex/visualizations/2026/07/30/019fb1ef-36c4-7170-a8fe-91ef92757714/kanban-locked-flow-v18-mobile-390x844.png`
- Source revision checked: `wangbh030722/vibe-nothing-ui-design@46661e55ae04537215a229be49f2ac1bd37a4255`
- Desktop viewport and pixels: 1536 × 1024 CSS px, browser DPR 2, capture normalized to 1536 × 1024px; source is 1536 × 1024px.
- Mobile viewport and pixels: 390 × 844 CSS px, browser DPR 2, capture normalized to 390 × 844px.
- State: dark theme, owner provisioned, Passkey choice visible. Dot and flow colors are compared as animated states rather than as one identical frame.

## Findings

No actionable P0, P1, or P2 mismatch remains for the requested corrections:

- the keyboard now uses one lightly angled top surface with softened outer corners and one rounded front face, without the former nested deck and lower base;
- keycap perspective is reduced to an 8px horizontal shift across the deck, retaining depth without returning to the earlier diamond/trapezoid appearance;
- all five main keyboard rows terminate on the same right alignment, so the typing block no longer contains a recessed notch;
- the `LOCKED` dot matrix now measures 513 × 98px at desktop, matching the source word scale and internal dot rhythm;
- the login actions form one 520 × 60px row with two 250px buttons and a 20px gap, matching the source composition;
- the five source routes remain independent and use nested turn columns, so no source line crosses another before entering `SYNC`;
- the chassis right-side red status point is present.

The monitor corner red point and the full-height screen divider remain absent because the user explicitly requested their removal. The red point inside the dashboard card remains part of the read-only data visualization.

## Required fidelity surfaces

- Fonts and typography: existing mono roles, provider names, `SYNC`, `VALUE`, and `READ ONLY` are unchanged. The login labels retain the same mono optical weight and tracking as the source.
- Spacing and layout rhythm: the final SVG bounds are approximately 670 × 591px. At desktop the eyebrow starts at x `128`, the dot word at x `128` / y `469`, and the action row at x `128` / y `611`. The monitor, connector, chassis, and keyboard retain the reference proportions without overlapping the login content.
- Colors and tokens: neutral hardware, route bases, active routes, reached stages, and status points use existing runtime tokens. No second visual language was introduced.
- Image and asset fidelity: the keyboard uses 88 projected SVG key paths with deliberately reduced perspective and rounded joins. Main, navigation/arrow, and numeric zones remain separate, while the body has only a top surface and one front face.
- Copy and content: sources remain `Longbridge`, `Binance`, `OKX`, `Bitget`, and `Web3`; stages remain `SYNC`, `VALUE`, and `READ ONLY`.
- Accessibility and responsiveness: the SVG retains a title and description. At 390 × 844 it is hidden, the buttons switch to one 318px column, the login surface remains visible, and document width is exactly 390px.

## Motion verification

The final 10-second timeline was captured in seven phases:

1. all five source points appear and move simultaneously;
2. five independent red trails reach five separate `SYNC` entry positions;
3. `SYNC` fades to the reached state;
4. one point moves from `SYNC` to `VALUE`;
5. `VALUE` fades to the reached state;
6. one point moves from `VALUE` to `READ ONLY`, which then fades in;
7. at 95%, routes and reached states reset immediately to neutral.

The neutral and active route strokes now share `stroke-dasharray: 2 4`, so the active red trail replaces the neutral dashes instead of producing a red-grey mixed pattern.

The five source routes now use nested turn columns: the outer Longbridge/Web3 paths turn at x `204`, the inner Binance/Bitget paths turn at x `192`, and OKX remains horizontal. Their vertical spans stop before the next horizontal source line, eliminating intersections.

## Comparison history

- [P1] Keyboard keycaps were flat rectangles and did not follow the reference perspective.
  - Fix: projected every key onto the trapezoidal deck and restored a dense main/navigation/numeric layout.
  - Evidence: `kanban-locked-flow-v16-keyboard-comparison.png`.
- [P1] Keyboard density and main-zone width were too small.
  - Fix: enlarged the five main rows, retained the long space bar, and repositioned the navigation and numeric zones.
  - Evidence: `kanban-locked-flow-v16-computer-comparison.png`.
- [P1] Neutral and active route dashes used different patterns, creating visual noise during reveal.
  - Fix: aligned both layers to the same dash rhythm and tightened the five independent rounded routes.
  - Evidence: `kanban-locked-flow-v16-animation-phases.png`.
- [P1] The chassis status point was missing.
  - Fix: restored one red status point at the chassis right side while keeping the removed monitor point absent.
  - Evidence: `kanban-locked-flow-v16-final-desktop.png`.
- [P1] The keyboard still read as a multi-layer diamond/trapezoid and the main typing block had a recessed right edge.
  - Fix: removed the nested deck and lower base, reduced horizontal perspective, changed the front face to a single rectangle, and aligned all five main rows to x `367`.
  - Evidence: `kanban-locked-flow-v17-keyboard-comparison.png`.
- [P1] Longbridge and Web3 vertical segments crossed inner source horizontals.
  - Fix: moved the outer turns to x `204` and inner turns to x `192`, with non-overlapping vertical spans.
  - Evidence: `kanban-locked-flow-v17-route-comparison.png` and `kanban-locked-flow-v17-routes-active.png`.
- [P2] Keyboard corners and key perspective remained slightly too sharp, while the left lock word and actions were too compact and positioned too far right.
  - Fix: softened the keyboard shell/front paths, reduced keycap projection, expanded the dot matrix to the source rhythm, aligned the left group to x `128`, and rebuilt the action row as two equal controls.
  - Evidence: `kanban-locked-flow-v18-keyboard-comparison.png` and `kanban-locked-flow-v18-login-comparison.png`.

## Verification

- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm exec playwright test e2e/locked-setup-accessibility.spec.ts`: 8 passed.
- Desktop document width: client 1536px, scroll 1536px.
- Mobile document width: client 390px, scroll 390px.
- Desktop login geometry: `LOCKED` 513 × 98px; action row 520 × 60px; button columns 250px + 250px with a 20px gap.
- Source paths: five unique, non-intersecting routes with separate `SYNC` entry heights.
- Keyboard geometry: 88 reduced-perspective key paths; rounded joins; nested deck count 0; lower base count 0.
- Hardware points: chassis status point 1; monitor corner point 0.
- Screen divider: 0.
- Browser console: no application errors.

## Previous targeted refinement

- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png` (1536 × 1024px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-stand-keyboard-audit/06-final-full.png` (1536 × 1024px at 1536 × 1024 CSS px, DPR 1).
- Focused comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-stand-keyboard-audit/06-final-connection-keyboard-side-by-side.png`.
- State: dark theme, owner provisioned, Passkey choice visible; the focused comparison normalizes the lower computer region to the same 680px width.

The latest pass fixed three remaining visible mismatches:

- [P1] The monitor neck base and chassis each exposed a trapezoid, creating a transparent-looking double connection.
  - Fix: draw the neck base behind one opaque rounded chassis face so only the thin upper connector remains visible.
- [P1] Hardware outlines mixed `--line-2`, `--secondary`, and several opacity values.
  - Fix: use one `--secondary` stroke at full opacity for the monitor, chassis, controls, keyboard shell, front face, and keys; computed stroke is consistently `rgb(140, 140, 140)`.
- [P2] The keyboard sides were too steep and the top key rows were too narrow.
  - Fix: widen the keyboard top edge to x `54–626`, preserve the bottom edge at x `30–650`, and project the key grid across the same shallower perspective.

The chassis divider and keyboard top remain 8 SVG units apart. The drive, power control, vent matrix, and red status point were aligned to the source. Active route, dashboard, and chassis signals now use the shared accent red instead of alternating between red and green.

Latest verification:

- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm exec playwright test e2e/locked-setup-accessibility.spec.ts`: 8 passed.
- Browser console: no errors or warnings.
- No actionable P0, P1, or P2 mismatch remains in the requested connection, chassis, keyboard, or hardware-color scope.

## Previous hardware refinement

- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png` (1536 × 1024px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/implementation-after.png` (1536 × 1024px at 1536 × 1024 CSS px, browser DPR 2, screenshot normalized to CSS pixels).
- Full computer comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/computer-side-by-side-after.png`.
- Focused hardware comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/hardware-focus-side-by-side-after.png`.
- State: dark theme, owner provisioned, Passkey choice visible; source is on the left and implementation is on the right.

This pass resolves the three user-corrected mismatches:

- [P2] The chassis vent matrix had only 8 columns × 3 rows.
  - Fix: restore the denser 9 columns × 4 rows matrix and vertically center the status point against the four rows.
- [P2] The keyboard top edge and projected key grid were too wide, making both side slopes shallower than the source.
  - Fix: narrow the top edge to x `64–616`, retain the bottom edge at x `30–650`, and restore the stronger key-grid projection from x `63.5–608` to x `38.5–633`.
- [P2] The neck-base polygon rendered behind the opaque chassis, hiding its lower horizontal segment.
  - Fix: render the chassis first and the neck/base afterward, preserving the opaque overlap while restoring one continuous connector outline.

Required fidelity surfaces:

- Fonts and typography: unchanged by this scoped hardware correction.
- Spacing and layout rhythm: monitor, chassis, and keyboard positions are unchanged; only the keyboard side projection and connector paint order changed.
- Colors and tokens: unchanged; all hardware outlines continue to use the shared `--secondary` color and status signals use `--accent`.
- Image and asset fidelity: the existing project-native vector illustration is retained; vent density, keyboard silhouette, and connector contour now match the visible source evidence.
- Copy and content: unchanged.

Latest verification:

- Vent circles: 36, arranged as 9 columns × 4 rows.
- Connector paint order: chassis before neck base, so the lower connector line remains visible.
- Desktop viewport: 1536 × 1024 CSS px; document scroll width is 1536px.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm exec playwright test e2e/locked-setup-accessibility.spec.ts`: 8 passed.
- Browser console: no errors or warnings.
- No actionable P0, P1, or P2 mismatch remains in the requested vent, keyboard-angle, or monitor-to-chassis connection scope.

## Latest connector refinement

- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png` (1536 × 1024px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/implementation-connector-refined.png` (1536 × 1024px at 1536 × 1024 CSS px).
- Focused comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/connection-refined-side-by-side-2x.png`.
- State: dark theme, owner provisioned, Passkey choice visible; source is on the left and implementation is on the right.

This pass corrects the remaining connector proportion mismatch:

- [P1] The monitor stand base appeared as a separate, tall inset trapezoid above the chassis.
  - Evidence: the source uses an approximately 5px vertical transition and a 624px lower edge, while the previous implementation used approximately 13px and a 604px lower edge at the normalized desktop capture.
  - Fix: compress the connector from SVG y `418–432` to y `418–424`, and expand its lower edge from x `34–646` to x `24–656`.
  - Post-fix evidence: the implementation now measures a 6px vertical transition and a 624px lower edge, matching the source within one pixel vertically and exactly in width.

Required fidelity surfaces:

- Fonts and typography: unchanged.
- Spacing and layout rhythm: only the connector height and lower width changed; monitor, chassis, keyboard, and page composition are unchanged.
- Colors and tokens: unchanged; the connector retains the shared hardware stroke and opaque background fill.
- Image and asset fidelity: the connector now reads as a thin stand-to-chassis transition instead of an independent middle layer.
- Copy and content: unchanged.

Latest verification:

- Connector path: `M58 418H622L656 424H24L58 418Z`.
- Desktop viewport: 1536 × 1024 CSS px; document scroll width is 1536px.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm exec playwright test e2e/locked-setup-accessibility.spec.ts`: 8 passed.
- Browser console: no errors or warnings.
- No actionable P0, P1, or P2 mismatch remains in the requested monitor-stand connector scope.

## Latest signal color correction

- Source visual truth: `/var/folders/hh/cg4z8pk92z59lqmtrjqb385r0000gn/T/codex-clipboard-2de42840-0287-46fc-abfc-68e21daa8dc7.png` (1427 × 1239px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/implementation-green-signals-default.png` (1265 × 1180px full-page capture).
- Side-by-side comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/green-signals-side-by-side.png` (1400 × 700px normalized comparison canvas).
- Browser viewport: 1280 × 720 CSS px, DPR 2.
- State: dark theme, owner provisioned, Passkey choice visible; capture taken during the bright phase of the chassis status animation.

This pass corrects the two user-identified semantic color regressions:

- [P1] The active source-to-value data path used the red accent instead of the reference green.
  - Fix: map `.locked-flow-route--signal` to the existing `--success` token.
- [P1] The chassis status point used a static red accent.
  - Fix: map `.locked-flow-device-status` to `--success` and add a 1.2-second stepped bright/dim blink; reduced-motion mode keeps one steady green state.

Required fidelity surfaces:

- Fonts and typography: unchanged.
- Spacing and layout rhythm: unchanged.
- Colors and tokens: the active route and chassis status resolve to `rgb(123, 227, 138)`; dashboard points remain `rgb(215, 25, 33)` so `READ ONLY` and red visualization signals are unaffected.
- Image and asset fidelity: the existing project-native vector illustration is retained.
- Copy and content: unchanged.

Latest verification:

- Status animation samples reached both `opacity: 1` and `opacity: 0.25`.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- `pnpm exec playwright test e2e/locked-setup-accessibility.spec.ts`: 8 passed.
- Browser console: no errors or warnings.
- No actionable P0, P1, or P2 mismatch remains in the requested signal-color scope.

## Latest monitor depth correction

- User-identified pre-fix evidence: `/var/folders/hh/cg4z8pk92z59lqmtrjqb385r0000gn/T/TemporaryItems/NSIRD_screencaptureui_CIch3T/截屏2026-07-31 02.32.51.png` (1536 × 1536px).
- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png` (1536 × 1024px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/implementation-monitor-forward-4.png` (1265 × 1180px full-page capture).
- Focused comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/monitor-forward-4-side-by-side.png` (1400 × 650px normalized comparison canvas).
- Browser viewport: 1280 × 720 CSS px, DPR 2.
- State: dark theme, owner provisioned, Passkey choice visible.

This pass corrects the remaining monitor-to-chassis depth mismatch:

- [P1] The monitor and support ended at the chassis rear edge, making the screen appear mounted behind the chassis rather than on its top surface.
  - Fix: move the outer monitor, inner screen content, neck, and neck base forward together by 4 SVG units while preserving the chassis and keyboard positions.
  - Post-fix geometry: the 6-unit neck-base surface now spans SVG y `422–428`, while the chassis begins at y `424`, creating a deliberate 4-unit overlap into the chassis top.

Required fidelity surfaces:

- Fonts and typography: unchanged.
- Spacing and layout rhythm: only the monitor/support depth plane moved; screen proportions, chassis, controls, vents, and keyboard remain fixed.
- Colors and tokens: unchanged; green routes and the green blinking chassis point remain intact.
- Image and asset fidelity: the existing project-native vector illustration is retained, with one consistent transform applied to all monitor-plane elements.
- Copy and content: unchanged.

Latest verification:

- Monitor back, monitor front, screen content, neck, and neck base all resolve to `translate(0 4)`.
- Desktop document width remains 1265px with no horizontal overflow.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Browser console: no errors or warnings.
- No actionable P0, P1, or P2 mismatch remains in the requested monitor-depth scope.

## Latest clarified monitor and support correction

- User clarification: `~/Desktop/截屏2026-07-31 02.45.00.png` (1536 × 1536px).
- User-identified insufficient-movement evidence: `/var/folders/hh/cg4z8pk92z59lqmtrjqb385r0000gn/T/codex-clipboard-4859f25d-4656-432f-a571-032a2b203506.png` (1329 × 1182px).
- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png` (1536 × 1024px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-stand-forward-audit/implementation-monitor-offset-2-full.png` (1536 × 1024px).
- Full-view comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-stand-forward-audit/full-source-left-implementation-right-offset-2.png`.
- Focused comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-stand-forward-audit/connection-source-left-implementation-right-offset-2.png`.
- Normalized focused comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-stand-forward-audit/connection-normalized-source-left-implementation-right.png`.
- Browser viewport: 1536 × 1024 CSS px, full-page screenshot 1536 × 1024px, DPR-normalized to one screenshot pixel per CSS pixel.
- State: dark theme, owner provisioned, Passkey choice visible.

The two preceding depth attempts are superseded by direct browser screenshot evidence:

- [P1] Moving the monitor by 12 SVG units compressed the visible stand and made the connection materially shallower than the source.
  - Pre-fix evidence: the rendered connection measured approximately 20px from the monitor bottom to the chassis top, while the source measures 30px.
  - Fix: reduce the monitor/content offset to 2 SVG units and restore the stand contact edge to the trapezoid's rear edge.
  - Support geometry: the monitor bottom and neck upper edge resolve to SVG y `394`; the neck rear contact remains at y `418`.
  - Preserve: keep the trapezoidal neck-base path exactly at `M58 418H622L656 424H24L58 418Z`.
  - Post-fix evidence: source monitor-bottom → trapezoid-rear-edge is 24px and monitor-bottom → chassis-top is 30px; implementation measures the same 24px and 30px.

Required fidelity surfaces:

- Fonts and typography: unchanged.
- Spacing and layout rhythm: the connection depth, vertical support height, and trapezoid transition now match the source proportions. The chassis, trapezoidal plane, controls, vents, and keyboard remain fixed.
- Colors and tokens: unchanged in this correction. The green route and blinking green chassis point remain intentional user-requested deviations from the red source state.
- Image and asset fidelity: the existing project-native vector illustration is retained; no replacement asset or second drawing system was introduced.
- Copy and content: unchanged.

Latest verification:

- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Chrome full-page capture completed at 1536 × 1024.
- Focused and normalized side-by-side comparisons completed.
- Application UI rendered without layout failure. The only captured console entries were Chrome-extension connection messages, not application-source errors.
- No actionable P0, P1, or P2 mismatch remains in the requested monitor-support-to-chassis connection scope.

## Latest corrected lower-hardware alignment

The previous “clarified monitor and support correction” is superseded for the lower hardware region by a fresh browser capture and a same-coordinate normalized comparison.

- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png` (1536 × 1024px).
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/implementation-after.jpg` (1265 × 1180px full-page capture).
- Normalized source computer: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/source-computer-normalized.png` (680 × 600px).
- Normalized implementation computer: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/implementation-computer.png` (680 × 600px).
- Full computer comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/source-left-implementation-right.png`.
- Focused lower-hardware comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/hardware-source-left-implementation-right.png`.
- Browser viewport: 1280 × 720 CSS px, DPR 2; full-page document capture is 1265 × 1180px.
- Normalization: source crop `(745, 261, 673, 593)` resized to 680 × 600px; implementation crop `(80, 492, 680, 600)` retained at 680 × 600px.
- State: dark theme, owner provisioned, Passkey choice visible; source is on the left and implementation is on the right.

The user-corrected comparison exposed three P2 geometry mismatches:

- [P2] The implementation trapezoid front edge was wider than the source.
  - Fix: narrow the lower edge from x `24–656` to x `30–650`, while keeping the rear edge and six-unit depth fixed.
- [P2] The chassis divider was approximately three pixels too high.
  - Fix: move the divider from SVG y `488` to y `491`.
- [P2] The keyboard was approximately four pixels too high.
  - Fix: move the complete keyboard group down four SVG units so the shell, keys, and front face retain one geometry.

Post-fix normalized evidence:

- connector/chassis upper edge: source y `423`, implementation y `423`;
- chassis divider: source y `490`, implementation y `490`;
- keyboard upper edge: source y `499`, implementation y `499`;
- keyboard lower/front edge: source y `577`, implementation y `577`;
- focused comparison shows the trapezoid front width, keyboard gap, keyboard side angle, and lower face aligned without moving the monitor or vertical support.

Required fidelity surfaces:

- Fonts and typography: unchanged by this scoped correction.
- Spacing and layout rhythm: connector width, divider position, chassis-to-keyboard gap, keyboard top edge, and keyboard lower edge now align in the normalized comparison.
- Colors and tokens: unchanged; the green route and blinking green chassis point remain intentional user-requested states.
- Image and asset fidelity: the existing project-native vector illustration is retained; no replacement asset or second drawing system was introduced.
- Copy and content: unchanged.

Latest verification:

- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Browser-rendered full-page and focused comparison evidence captured.
- No actionable P0, P1, or P2 mismatch remains in the requested trapezoid, chassis-divider, or keyboard-spacing scope.

## Latest chassis status-light correction

- Source visual truth: `~/Desktop/call_ymaTTYz2Ak7D7WmXsIm0NVIO.png`.
- Browser-rendered implementation: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/implementation-status-corrected.jpg`.
- Normalized implementation computer: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/implementation-computer-status-corrected.png`.
- Focused comparison: `~/.codex/visualizations/2026/07/30/019fb3a0-f204-71a3-9e14-92adc40baaf0/login-hardware-audit/current-adjustment/status-source-left-implementation-right.png`.
- Browser viewport: 1280 × 720 CSS px, DPR 2; capture taken during the bright phase of the blinking green status.

The focused comparison exposed one P2 mismatch:

- [P2] The implementation status light was smaller and sat slightly right and below the source.
  - Pre-fix normalized bounds: implementation `6 × 6px`, center `(621.5, 461.5)`; source `8 × 8px`, center `(620.5, 456.5)`.
  - Fix: change the status circle from `cx=622`, `cy=462.5`, `r=3` to `cx=621`, `cy=457.5`, `r=4`.
  - Post-fix normalized bounds: implementation `8 × 8px`, center `(620.5, 456.5)`, exactly matching the source geometry.

Required fidelity surfaces:

- Fonts and typography: unchanged.
- Spacing and layout rhythm: only the status-light center and radius changed.
- Colors and tokens: the user-requested success green and stepped blink remain unchanged.
- Image and asset fidelity: the existing vector status circle is retained.
- Copy and content: unchanged.

Latest verification:

- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Browser-rendered focused comparison completed during the full-opacity animation phase.
- No actionable P0, P1, or P2 mismatch remains in the requested chassis status-light scope.

## Follow-up polish

No P3 follow-up is required for this scoped status-light correction.

final result: passed
