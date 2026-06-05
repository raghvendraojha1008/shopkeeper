# Shopkeeper V2

A mobile-first ledger and inventory management application for small business owners.

## Run & Operate

To install dependencies and start the development server:

```bash
npm install --legacy-peer-deps
npm run dev
```

The development server runs on `http://0.0.0.0:5000`.

**Required Environment Variables:**
- `VITE_BACKEND_URL`: Base URL for the payment backend (e.g., `https://your-backend.onrender.com`)
- `VITE_RAPIDAPI_KEY`: API key for the GST API.

**Firebase Configuration:**
- `firestore.rules`: Deploy via Firebase Console or `firebase deploy --only firestore:rules`.
- `firestore.indexes.json`: Deploy via `firebase deploy --only firestore:indexes`.

**Admin Panel Configuration:**
- Set `superAdmin` custom claim for admin accounts: `admin.auth().setCustomUserClaims(adminUid, { superAdmin: true })`.

## Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4
- **State Management:** TanStack Query v5, React Router v7 (HashRouter for Capacitor)
- **Backend/BaaS:** Firebase 12 (Firestore, Auth)
- **Mobile:** Capacitor 8 (Android/iOS)
- **AI:** Google Generative AI (Gemini)
- **Charts:** Recharts
- **Icons:** Lucide React

## Where things live

- `src/`: Main React application source
  - `components/`: Reusable UI components
  - `context/`: Global state providers (`Auth`, `Subscription`, `Data`, `Role`, `UI`)
  - `services/`: API logic, Firebase config, payment services
  - `hooks/`: Custom React hooks
  - `types/`: TypeScript type definitions
- `android/` & `ios/`: Capacitor native project files
- `pdf-generator/`: Custom Capacitor plugin for native PDF generation
- `public/`: Static assets and PWA icons
- `firestore.rules`: Defines Firestore security rules (source-of-truth)
- `src/config/firebase.ts`: Firebase client-side configuration
- `firestore.indexes.json`: Firestore composite indexes definition

## Architecture decisions

- **Subscription System Flow:** Prioritizes backend/admin-driven subscription activation. New users default to a Free plan; no automatic trials or promotions from the client side. Subscription changes are primarily managed via a dedicated backend or admin panel, with the frontend initiating payment requests but not directly writing subscription status to Firestore.
- **Expiry Detection:** Utilizes a combination of `setInterval`, `document.visibilitychange`, and Capacitor's `appStateChange` listener for robust, real-time expiry detection across web and mobile platforms.
- **Payment Security:** All sensitive payment operations (order creation, signature verification, subscription writes) are handled by an external backend. The frontend only initiates requests and displays UI, ensuring no Razorpay secrets or direct subscription writes occur client-side.
- **Kill Switch Mechanism:** A global kill switch via `config/global.appMode` in Firestore allows instantly toggling the subscription system off (`appMode = 'free'`) to grant all users Pro access, or on (`appMode = 'hybrid'`) for normal operation.
- **Audit Logging:** Comprehensive audit trails for subscription changes are maintained in `subscription_logs` collection, with entries originating from both the backend (payment success) and the admin panel (manual grants).

## Product

- Mobile-first ledger and inventory management.
- Real-time subscription status display, including trial countdowns and upgrade prompts.
- Integrated payment flows for Razorpay, UPI, Bank Transfer, and Cash.
- Real-time transaction history view reflecting all subscription changes.
- Announcement banner for displaying scheduled, time-bound messages.
- Security features: app lock with PIN, password reset, weak-PIN detection (live warning while typing).
- Dynamic dashboard cards with deep-linking to filtered views (e.g., "To Pay", "To Receive").
- **Recurring transactions** (`src/services/recurringService.ts`): template stored in `users/{uid}/recurring_templates`; auto-creates entries on app open (once/day). Toggle in TransactionForm.
- **Bulk party CSV import**: already available in BulkImportView under "Parties" tab.
- **Unified quick-search** in TransactionsView: searches party, amount, notes, payment mode, txn ID, reference. Results highlight matched text.
- **Offline pending-sync badge**: expandable panel shows queue count + "Sync Now" button even when back online.
- **Kill switch** (`config/global.appMode`): when `'free'`, Subscription section is fully hidden from Settings menu. Admin portal: `admin-portal-kill-switch/SubscriptionKillSwitch.tsx`.

## User preferences

- _Populate as you build_

## Gotchas

- **`--legacy-peer-deps`**: Required during `npm install` due to a peer dependency conflict with `@capacitor-community/barcode-scanner` requiring Capacitor 5 while the project uses Capacitor 8.
- **Android Package ID Change**: After changing the Android package ID (`com.shopkeeper.Webledger` to `com.shopledger.india`), a full rebuild in Android Studio is required, and the app must be re-signed with the same keystore before Play Store upload.
- **Backend URL for Payments**: For full payment functionality (especially Razorpay), ensure `VITE_BACKEND_URL` is correctly set in Replit Secrets. Manual payments have a fallback if not configured.
- **Firestore Rules/Indexes**: Always publish `firestore.rules` and deploy `firestore.indexes.json` after changes to ensure proper security and query performance.

## Pointers

- [React Documentation](https://react.dev/learn)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Razorpay Integration Guide](https://razorpay.com/docs/api/)