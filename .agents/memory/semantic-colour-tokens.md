---
name: Semantic colour surface tokens
description: How hardcoded rgba() tints are tokenized; naming convention and token locations.
---

## Rule
Never write `rgba(59,130,246,0.12)` (or any other semantic colour) inline in a component file. Use `var(--col-info-12)` instead.

**Why:** The codebase had 750+ hardcoded rgba() instances across 198 files; they were replaced en-masse with named tokens to centralise values and make light/dark theming easier.

## Token naming convention
`--col-<semantic>-<opacity×100>` where the suffix is zero-padded to 2 digits.

| Colour | RGB | Token prefix |
|---|---|---|
| Info / Blue | 59,130,246 | `--col-info-` |
| Danger / Red | 239,68,68 | `--col-danger-` |
| Warning / Amber | 245,158,11 | `--col-warning-` |
| Success / Emerald-500 | 52,211,153 | `--col-success-` |
| Emerald-600 | 16,185,129 | `--col-emerald-` |
| Violet / Purple | 139,92,246 | `--col-violet-` |
| Indigo-600 | 79,70,229 | `--col-indigo-` |
| Accent / Indigo-500 | 99,102,241 | `--col-accent-` |
| Black overlay | 0,0,0 | `--rgba-black-` |

Examples: `--col-danger-15` = `rgba(239,68,68,0.15)`, `--rgba-black-40` = `rgba(0,0,0,0.40)`.

Solid (non-alpha) palette aliases also defined: `--col-violet-500/600/700`, `--col-indigo-500/600`.

## Location
All token definitions live in the **final `:root {}` block** of `src/index.css`, clearly marked with the heading `SEMANTIC COLOUR SURFACE TOKENS`.

## Chart font sizes
`--font-size-chart-xs: 10px`, `--font-size-chart-sm: 12px`, `--font-size-chart-md: 14px` are in the same block.

## How to apply
When adding any new tinted colour surface in a component, pick the closest existing token. If the exact opacity isn't in the table, add a new entry to the `:root` block in `src/index.css` before using it.
