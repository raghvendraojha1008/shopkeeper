---
name: Light/dark theme system (shopkeeper-v2)
description: How theme switching actually works in this app — the toggle gate, the CSS variable tiers, and the legacy fallback CSS.
---

The app has a real, fairly complete CSS-variable theming system, driven by `document.documentElement.dataset.themeMode` ('light'|'dark') set from `applyThemeToDocument()` in `src/theme/theme.ts`, based on `AppSettings.preferences.dark_mode`.

**Do not reintroduce a hardcoded force-dark flag.** A `FORCE_DARK_MODE = true` constant in `src/App.tsx` used to short-circuit the user's preference and make the Settings/Dashboard toggle UI dead code (still rendered but gated behind `{false && ...}`). Removed 2026-07-15. If dark/light looks "stuck", check for this pattern before debugging CSS.

**Two parallel neutral-color variable families exist** — prefer them over literal `rgba(...)` in new code:
- `--text-primary` / `--text-secondary` / `--text-muted` — semantic text colors, swap automatically per `[data-theme-mode]`.
- `--rgba-white-XX` (XX = alpha tier: 02,03,04,05,06,07,08,09,10,12,14,15,18,20,25,30...95) — white-on-dark tint that becomes a black-on-light tint of similar visual weight in light mode. Defined in `src/index.css` near the end of the file. Use the nearest tier rather than inventing new literals.
- `--glass-border` / `--glass-bg` / `--surface-1/2/3` / `--separator` also exist for card/border surfaces.

**Legacy fallback exists and is safe to leave**: `src/index.css` also has a large block (~500+ `!important` rules) of `[data-theme-mode="light"] [style*="..."]` / `[class*="..."]` attribute-substring selectors that patch specific hardcoded literal colors for light mode. These only match if the literal string is still present in the rendered inline style/class — migrating a component to a CSS variable makes the matching hack rule silently inert (harmless), not broken. When fixing a hardcoded color, prefer converting it to a variable over adding another `!important` hack rule.

**Why:** ~1500+ inline `rgba(...)` literals were found hardcoded across ~110 component files (mostly `rgba(148,163,184,*)`/`rgba(226,232,240,*)` for text, `rgba(255,255,255,*)` for borders/surfaces) — these assumed a dark background and were invisible/low-contrast once light mode was reachable. Bulk-converted via scripted regex (matched on exact property context: `color:` for text families, `solid rgba(255,255,255,X)` for borders, `background:` for surfaces) to the variable equivalents; verified via `tsc --noEmit` diff (error count/lines unchanged) that no logic broke.
