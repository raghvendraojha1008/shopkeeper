---
name: Modal & dropdown surface tokens
description: CSS vars replacing hardcoded dark rgba backgrounds in modals, sheets, dropdowns, and snackbars.
---

## Rule
Never hardcode dark rgba backgrounds in modal/sheet/dropdown containers. Use vars defined at the bottom of `src/index.css`:

| Var | Dark default | Light override |
|-----|-------------|----------------|
| `--modal-bg` | rgba(13,17,40,0.98) | #ffffff |
| `--modal-sheet-bg` | rgba(15,18,35,0.98) | #ffffff |
| `--modal-footer-bg` | rgba(11,13,26,0.60) | rgba(237,241,255,0.97) |
| `--dropdown-bg` | rgba(15,18,40,0.99) | #ffffff |
| `--popover-bg` | rgba(12,16,40,0.98) | #ffffff |
| `--col-app-bg-mid` | #0f1221 | #f0f4fc |

**Why:** All modals/sheets/dropdowns had hardcoded near-black colors; in light mode they stayed pitch-dark.

**How to apply:**
- Modal container → `style={{ background: 'var(--modal-bg)' }}`
- Bottom sheet → `var(--modal-sheet-bg)`
- Sheet footer bar → `var(--modal-footer-bg)`
- Inline dropdown/picker → `var(--dropdown-bg)` or `var(--popover-bg)`
- Heading text `text-white` → `style={{ color: 'var(--text-primary)' }}`
- Border `border-white/10` → `style={{ border: '1px solid var(--glass-border)' }}`
