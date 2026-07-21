# shopkeeper-v2

A React + TypeScript + Vite POS/business management web app with Firebase backend, Capacitor (Android), TanStack Query, Tailwind CSS, and Gemini AI integration.

## How to run

```
npm run dev
```

Runs on port 5000. The Vite config is already set up for Replit (host `0.0.0.0`, `allowedHosts: true`, HMR over WSS).

## Stack

- **Frontend**: React 19, TypeScript, Vite 5, Tailwind CSS 4
- **Routing**: React Router 7
- **State / cache**: TanStack Query 5 + idb-keyval (IndexedDB persistence)
- **Backend**: Firebase (Firestore + Auth) — credentials hardcoded in `src/config/firebase.ts` for project `shopkeeper-1a3fc`
- **Mobile**: Capacitor 8 (Android build in `/android`)
- **AI**: Gemini API — set `VITE_GEMINI_API_KEY` env var to enable AI features
- **PDF/export**: jsPDF, jspdf-autotable, xlsx

## Key directories

| Path | Purpose |
|------|---------|
| `src/components/` | UI components and views |
| `src/context/` | React context providers (DataContext, AuthContext, etc.) |
| `src/hooks/` | Custom hooks |
| `src/services/` | Firebase API service layer |
| `src/config/` | Firebase init, app settings |
| `src/utils/` | Utility functions |
| `android/` | Capacitor Android project |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_GEMINI_API_KEY` | Optional | Enables Gemini AI features |
| `SESSION_SECRET` | Yes | Session signing |

## User preferences
