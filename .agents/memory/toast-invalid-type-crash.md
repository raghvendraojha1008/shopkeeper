---
name: Toast invalid-type crash
description: How the 'Cannot read properties of undefined (reading grad)' Android crash is caused and fixed.
---

## Rule
`ToastType` only accepts `'success' | 'error' | 'info'`. Any other string (e.g. `'warning'`) makes `cfg` undefined and crashes Toast during render, which propagates to `AppErrorBoundary` since the Toast lives inside `UIProvider` at the root — outside any `ShellErrorBoundary`.

**Root cause found:** `OnboardingView.tsx` called `showToast(message, 'warning')` — `'warning'` is not in the config map.

## Fix applied
1. `src/components/auth/OnboardingView.tsx` — changed `'warning'` → `'info'` at the profile-save timeout toast.
2. `src/components/common/Toast.tsx` — made `cfg` and `Icon` lookups defensive with `?? CONFIGS.info` / `?? Info` fallback so any future invalid type renders as info instead of crashing.

**Why:** The UIProvider renders Toast directly in the context tree (not wrapped in a ShellErrorBoundary), so a render throw in Toast escalates to the full-screen AppErrorBoundary crash screen on Android.

**How to apply:** Never pass a type string to `showToast` that isn't `'success' | 'error' | 'info'`. The TypeScript type `ToastType` enforces this at compile time, but runtime callers (dynamic types from callbacks like `onToast`) bypass it.
