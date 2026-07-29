# Vibe-Nothing-UI upstream record

This directory is a read-only vendored snapshot of the design system used by KanBan.

| Field | Value |
| --- | --- |
| Repository | <https://github.com/wangbh030722/vibe-nothing-ui-design> |
| Branch | `main` |
| Commit | `46661e55ae04537215a229be49f2ac1bd37a4255` |
| Imported on | `2026-07-29` |
| Code and documentation license | MIT (`LICENSE`) |
| Font licenses | SIL OFL 1.1 (`fonts/open/OFL-*.txt`) |

## Source-of-truth order

1. `SPEC.md` — normative implementation contract.
2. `index.html` — rendered visual source of truth.
3. `DESIGN.md` — rationale, token roles, and design decisions.
4. `css/tokens.css` and `css/nothing-ui.css` — upstream implementation evidence.

KanBan-specific documentation may explain React integration, accessibility, Chinese fallback fonts, and product-domain constraints. It must not silently redefine upstream visual tokens or component recipes.

## Imported files

- `README.md`
- `SPEC.md`
- `DESIGN.md`
- `LICENSE`
- `index.html`
- `css/tokens.css`
- `css/nothing-ui.css`
- `js/nothing-ui.js`
- `fonts/open/*`

The vendored vanilla JavaScript is reference evidence only. KanBan reimplements behavior in React and does not execute `js/nothing-ui.js` in production.

## Integrity baseline

```text
tokens.css      fb26bb27e4358a09a41bc45d0cb4d14ea5bbc014bb7f74cc8bbcc0fe7712a694
nothing-ui.css  7df6d9e9b1a8faf723e74ba37ab0f0420e7e2d53a4ae34354dec9be0e0ea2677
Newsreader      a7a0a9114e29fbf6e83a339ed930d5d8ae69fe4217c34fdd95386d995929d6e8
```

## Updating the snapshot

1. Review the upstream diff from the pinned commit to the proposed commit.
2. Re-copy the imported files without editing them locally.
3. Update the commit and integrity baseline in this file.
4. Update KanBan's React design module and browser acceptance evidence.
5. Never update the vendor snapshot and product adaptation in an unreviewed single mechanical step.
