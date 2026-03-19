# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint via next lint
npm run start    # Start production server
```

No test suite is configured.

## Environment Variables

Two sets of Firebase credentials are required:

**Client-side** (in `.env.local`):
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

**Server-side only**:
- `FIREBASE_PROJECT_ID` (falls back to `NEXT_PUBLIC_FIREBASE_PROJECT_ID`)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (newlines encoded as `\n`)
- `NEXT_ANTHROPIC_API_KEY`

## Architecture

This is a Next.js 14 App Router app for household financial tracking, targeted at Christian couples, with a Dave Ramsey-inspired budgeting philosophy.

### Route Groups

- **`app/(main)/`** — authenticated shell with `AppSidebar`. Pages: `dashboard`, `budget`, `transactions`, `financial-advisor`, `settings/*`
- **`app/onboarding/`** — multi-step onboarding flow (profile → household → loans → accounts → upload → review → questions → analyzing → report → invite)
- **`app/login/`, `register/`, `forgot-password/`, `reset-password/`, `join/`** — auth pages

### Data Model (Firestore)

The root collection is `households/{householdId}`:
- **`transactions`** — subcollection; fields: `date`, `desc`, `amount`, `type` (`income|expense|transfer|refund`), `category`, `subcat`, `account`, `accountId`, `accountSnapshot`, `direction`, `flagged`, `reviewed`, `transferPairId`, `assignedTo`, `sourceDocId`, `month`
- **`accounts`** — user's bank accounts; fields: `nickname`, `bankName`, `last4`, `cardLast4`, `type`, `owner` (uid or `"joint"`), `ownerName`, `color`
- **`documents`** — imported bank statements; tracks `fileName`, `statementStart/End`, balances, `transactionCount`
- **`reports`** — AI-generated financial analysis reports; referenced by `households.latestReportId`
- **`users/{uid}`** — user profiles with `monthlyIncome`, `debtAnswers`, `ownsOrRents`, `hasDebt`

### API Routes (`app/api/`)

All routes use Firebase Admin SDK (server-only):

- **`POST /api/parse-document`** — accepts a raw bank statement file, sends to Claude for parsing into structured JSON
- **`POST /api/import-statement`** — takes Claude-parsed JSON, matches accounts using `findAccount()`, writes transactions to Firestore in batches of 400
- **`POST /api/analyze`** — reads all household transactions, calls Claude per-month via `analyzeMonth()` + one overall summary call, writes a report to `reports/` subcollection. Has `maxDuration = 60`.

### Key Libraries

- **`app/lib/firebase.ts`** — client Firebase SDK (`auth`, `db`, `storage`)
- **`app/lib/firebaseAdmin.ts`** — server-only Admin SDK (`adminDb`, `adminStorage`); marked `"server-only"`
- **`app/lib/claude.ts`** — thin wrapper around Anthropic API using `claude-sonnet-4-20250514`; marked `"server-only"`
- **`app/lib/categories.ts`** — canonical `CATEGORIES` array (11 categories, each with subcategories, emoji, color, defaultType). This is the source of truth for all categorization.

### Hooks Pattern

All data fetching for the client is done through custom hooks in `app/hooks/`. Each hook subscribes to a Firestore path via `onSnapshot` and returns `{ data, loading }`. Key hooks:
- `useAuth` — wraps Firebase `onAuthStateChanged`
- `useTransactions(householdId)` — streams `households/{id}/transactions` ordered by date desc
- `useAccounts`, `useMembers`, `useBudget`, `useLoans`, `useDocuments`, `useSubcategories`, `useOnboarding`, `useHouseholdDebt`, `useDebtAnswers`

### Account Matching Logic

`findAccount()` in `/api/import-statement/route.ts` contains hardcoded account-matching rules for specific banks (PNC, Credit One, Citadel) and account holders (Gabriel, Victoria). When adding new accounts or banks, update this function.

### Deployment

Deployed on Netlify via `@netlify/plugin-nextjs`. Build command: `npm run build`, publish dir: `.next`.

### Utility Scripts

Root-level `.js` scripts are one-off Firestore admin utilities (inspect data, fix links, reset imports). They use `serviceAccountKey.json` directly and are not part of the app.
