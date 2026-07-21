---
name: Systemic light/dark theme adapter system
description: How the app enforces automatic light/dark mode adaptation for ALL components — present and future — without per-component work.
---

## The system

Three layers work together so any component automatically adapts to light/dark mode:

### Layer 1 — CSS custom properties (src/index.css)
- `:root` block holds dark-mode defaults for ALL tokens.
- `[data-theme-mode="light"]` block overrides every token that changes in light mode.
- All surface/text/border values live here. Never hardcode rgba() or hex in components.

### Layer 2 — Systemic CSS override block (inside `[data-theme-mode="light"]`)
Added a comprehensive block that makes static Tailwind color classes theme-aware:

```css
/* text-white → var(--text-primary) in light mode */
.text-white { color: var(--text-primary); }

/* text-white/XX opacity variants */
[class*="text-white/8"], [class*="text-white/9"] { color: var(--text-secondary); }
[class*="text-white/3"]…[class*="text-white/7"] { color: var(--text-muted); }

/* Restore white on coloured Tailwind bg classes (both same-element and child) */
:is(.bg-red-400,…,.bg-black).text-white { color: white !important; }
:is(.bg-red-400,…,.bg-black) .text-white { color: white !important; }

/* .on-color utility — for inline-style coloured backgrounds CSS can't detect */
.on-color .text-white, .on-color.text-white { color: white !important; }

/* border-white/XX → var(--glass-border) */
[class*="border-white"] { border-color: var(--glass-border); }
```

ALSO: there is an older block (~line 804 in index.css) with explicit per-class selectors AND
linear-gradient inline-style attribute selectors — keep it, it adds coverage the :is() block can't.

### Layer 3 — Tailwind config CSS-variable utilities (tailwind.config.js)
`th-*` color utilities backed by CSS variables, for future components:
- `text-th-primary` → `var(--text-primary)`
- `bg-th-card` → `var(--card-bg)`
- `bg-th-modal` → `var(--modal-bg)`
- `border-th-border` → `var(--glass-border)`
- etc. (all 13 `th-*` keys)

## Convention for future components

- **Text**: use `text-th-primary`, `text-th-secondary`, `text-th-muted` OR `text-[var(--text-primary)]`
- **Backgrounds**: use `bg-th-card`, `bg-th-modal`, etc. OR inline `style={{ background: 'var(--card-bg)' }}`
- **Borders**: use `border-th-border` OR `border-[var(--glass-border)]`
- **Coloured inline backgrounds** (gradients, etc.): add `on-color` class so `text-white` stays white

**Why:** Static Tailwind classes (text-white, border-white/XX) are immune to CSS variable changes.
The systemic CSS override layer neutralises them globally; `th-*` utilities opt in to theme-awareness by design.

## Dark rgba backgrounds were mass-replaced (July 2026)
Script replaced all near-opaque dark navy rgba() backgrounds in inline styles across 11 files:
- `rgba(15,20,40,0.9X)` → `var(--modal-bg)`
- `rgba(16,20,40,0.98)` → `var(--modal-bg)`
- `rgba(14,12,40,0.99)` → `var(--modal-bg)`
- `rgba(18,16,50,0.99)` → `var(--modal-bg)`
- `rgba(7,9,30,0.92)` → `var(--modal-bg)`
- `rgba(30,20,60,0.85)` → `var(--col-violet-20)` (violet active-pill)
- `rgba(100,100,200,0.08)` → `var(--surface-1)`
- Tailwind arbitrary `bg-[rgba(...)]` classes → `bg-[var(--modal-bg)]`

**Why:** These were the root cause of dark cards/modals appearing on a light page background.
