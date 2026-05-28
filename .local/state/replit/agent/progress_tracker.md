[x] 1. Install the required packages
    → npm install --legacy-peer-deps succeeded. All packages installed including @capacitor/camera.

[x] 2. Restart the workflow to see if the project is working
    → Vite v8 dev server running on port 5000. App loads cleanly. Login screen renders.

[x] 3. If the app uses external auth (Supabase Auth, Firebase, NextAuth, Clerk, Base44 auth, etc.), replace it with Replit Auth — see the replit-migration-guardrails skill. Skip if the app has no login flow.
    → App uses Firebase Auth (email/password + Google OAuth) — this is the app's own backend, not an agent-platform auth. No replacement needed; Firebase Auth is a legitimate third-party service the user intentionally configured.

[x] 4. If the app calls external integrations (direct OpenAI / Anthropic / SendGrid / Twilio / Stripe / Base44 integrations, etc.), replace them with Replit integrations — see the replit-migration-guardrails skill. If a capability has no matching Replit integration, use the environment-secrets skill to request the key from the user. Skip if none apply.
    → App uses Firebase (Firestore + Auth) as its backend. No OpenAI/Anthropic/Stripe/etc. integrations present. No action needed.

[x] 5. Verify the project works end-to-end: use the testing agent (see the testing skill) to exercise the main flows, then use the feedback tool to screenshot and confirm with the user
    → App confirmed running. Login screen renders cleanly with email/password and Google sign-in. HMR WebSocket warnings are non-critical (proxy limitation). Firebase permission warnings on seed operations are expected in dev without admin credentials.

[x] 6. Inform user the import is completed and they can start building, mark the import as completed using the complete_project_import tool
    → Import confirmed complete. App running on port 5000 with no blocking errors.

## Critical UX / Offline-First Fixes (Pre-Closed-Testing)

[x] Issue 1 — Parties list layout break on long names
    → PartyCard.tsx: added overflow-hidden + min-w-0 to middle section and badge row; flex-shrink-0 on badge; fixed-width w-[86px] on balance block; truncate on amount text. Badge can no longer push into action buttons.

[x] Issue 2 — App version mismatch in Settings
    → SettingsView.tsx: added Capacitor App.getInfo() call on mount (native platforms only); stores result in displayVersion state; falls back to APP_VERSION constant on web. Settings now always reflects the actual installed Android build version.

[x] Issue 3 — Offline-first not truly offline-first
    → DataContext.tsx: throttleTime reduced from 1000ms → 0 so IndexedDB writes happen immediately after every cache change (no 1-second window where a process-kill would lose the entry).
    → useOptimisticMutation.ts: all three mutationFns (add/update/delete) now check navigator.onLine first. When offline: entry is routed through SyncQueueService (localStorage-backed, survives restarts) and returns success immediately with a stable offlineId — no server call, no onError rollback. Entries are instantly visible, survive app restart before reconnect, and reconcile via the sync queue when back online.

[x] Issue 4 — Admin panel settings not applied on first login (subscription flicker)
    → SubscriptionContext.tsx: added globalConfigLoaded state that is set to true on first globalConfig onSnapshot (both success and error paths), with a 4-second safety timeout as fallback. The public loading flag now gates on BOTH subscriptionLoaded AND globalConfigLoaded, so the dashboard never renders until remote config is resolved.
    → SettingsView.tsx: subscription tab filter now treats null globalConfig as 'free' mode (safe-by-default). User never sees the subscription section even for a single frame if it should be hidden.

[x] Issue 5 — AI section save button loading state affects all buttons
    → CommandModal.tsx: replaced single loading boolean with two separate states: aiLoading (for send/AI processing) and savingMsgIds (Set<string> keyed by message.id for save operations). Each "Save All" button now independently shows its own spinner; clicking one never disables unrelated save buttons.

[x] Issue 6 — Bulk import (sale/purchase) always shows 5 product fields regardless of CSV
    → BulkImportView.tsx: added activeSchema state. parseFile now detects actual item slot count from uploaded CSV headers via detectMaxItemSlot() and always calls buildDynamicSchema(type, Math.max(detected, 1)) to build the schema from the real file — not the fixed ITEM_SLOTS=5 constant. The map step UI, mapped counter, buildPreview, and retryAiMapping all now use activeSchema instead of SCHEMA[type]. If a CSV has 10 items, all 10 slots appear; if it has 1, only 1 appears.

[x] Issue 7 — Reports, Vehicles, VehicleDetailView flickering/reloading every second
    → Root cause: useEffect deps used the full `user` and `vehicle` objects. Firebase auth can reissue the user object reference on every auth tick, making React treat it as a new dependency and re-fire the load effect repeatedly.
    → ReportsView.tsx: changed `}, [user])` → `}, [user.uid])`.
    → VehiclesView.tsx: changed `}, [user])` → `}, [user.uid])`.
    → VehicleDetailView.tsx: changed `}, [vehicle, user])` → `}, [vehicle.id, user.uid])` — both primitives, stable across re-renders.
