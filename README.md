# SPMS — Solar Project Monitoring System

Internal platform for PT Solar EPC Nusantara to manage Solar EPC project
execution end to end — from Contract Award through Final Acceptance
Certificate (FAC) — before handover to PWMS (Project Warranty Management
System) for the warranty period.

**Status: functional prototype, not production-ready.** Four primary
modules (Dashboard, Project Master, Project Cost Control, User Management)
are implemented end to end against a local mock data layer. A parallel
Firestore-backed repository implementation exists for `users` and
`projects` plus all project subcollections and Cost Control, but has
**never been exercised against a real Firebase project or the Firebase
emulator** — see Known Limitations before assuming anything
Firebase-related works as-is.

## Current implementation status

| Module | Status | Notes |
|---|---|---|
| Dashboard | Functional | 8 approved KPIs/panels, project rotation, real S-Curve from recorded progress snapshots |
| Project Master (List + 8-tab Detail) | Functional | Overview, Team, Work Structure, Progress, Engineering, HSE/Permit, Issues, Reports |
| Progress Engine | Functional | Engineering/Procurement/Construction/Commissioning + optional HSE weighting, centralized in `progressRepository.js` |
| Project Cost Control | Functional | DRAFT/POSTED/VOID ledger, 3-layer duplicate detection, HC/Finance double-counting prevention |
| Issue Management | Functional | Create/Edit/Close/Reopen, period-overlap Weekly/Monthly reporting rule |
| Weekly/Monthly PDF Reports | Functional | Generated client-side (jsPDF) from a centralized Report Data Engine |
| User Management | Functional | Create/Edit/Activate/Deactivate, Super Admin only |
| Role-based route/action guards | Functional | Centralized in `constants/nav.js` + `ProtectedRoute.jsx`; UI hiding is never the only enforcement layer |
| Firestore persistence | Partially prepared, unverified | Repository layer branches cleanly between mock and Firestore; Firestore side has never run against a live project or emulator (network-restricted dev sandbox) |
| Firestore Security Rules | Draft, untested | `firestore.rules` encodes the intended policy; never deployed or tested against the emulator |

## Tech stack

React 19 + Vite · Material UI · React Router · React Hook Form · Firebase
(Auth/Firestore/Storage) · Chart.js · jsPDF · Vitest

## Getting started

```bash
npm install
npm run dev
```

With no `.env` file (or an incomplete one), the app runs in **LOCAL MODE**:
a dummy `SUPER_ADMIN` user is auto-authenticated and all data is served
from the in-memory mock layer under `src/data/`. This is the only mode
that has actually been run and verified in this repository's development
history so far.

### Firebase setup (prepared, not verified end-to-end)

1. Create a project at https://console.firebase.google.com
2. Enable **Authentication → Email/Password**
3. Create a **Cloud Firestore** database
4. In Project settings → General, register a Web App and copy the config
   values into `.env` (see `.env.example` — never commit real values)
5. Create at least one user in Authentication, then create a matching
   profile document in Firestore at `users/{firebaseUid}`:
   ```json
   { "name": "Jane Doe", "email": "jane@example.com", "role": "PROJECT_MANAGER", "department": "Project Management", "status": "ACTIVE" }
   ```
   An authenticated user with no profile document, or whose profile
   `status` is not `ACTIVE`, is denied access and signed back out
   automatically — the app never falls back to a default role.
6. Deploy `firestore.rules` (currently a **draft**, see below) via the
   Firebase CLI: `firebase deploy --only firestore:rules`. Have this
   reviewed before deploying to any project with real data.

None of the above has been executed in this repository's development
environment — see Known Limitations.

### Firestore collections

Defined centrally in `src/services/firebase/firestorePaths.js`:

- `users`
- `projects`, and under each project:
  `projectAssignments`, `progressHistory`, `engineeringDocuments`,
  `hseItems`, `procurementMilestones`, `constructionActivities`,
  `commissioningItems`, `issues`, `costTransactions`, `paymentProjections`

Stable IDs (`userId`, `projectId`, `issueId`, `transactionId`,
`projectionId`) are the relationship keys throughout; display names are
never used as identity.

## Local development

```bash
npm run dev      # Vite dev server, LOCAL MODE unless .env is fully configured
npm run build    # production build
npm run lint     # oxlint
npm run test     # vitest -- pure business-logic tests, no Firebase required
npm run preview  # preview a production build
```

## Testing

`npm run test` runs Vitest unit tests against the pure calculation/business
-rule functions (Progress Engine, Cost Control ledger logic, HC/Finance
double-counting prevention, Weekly/Monthly issue period rule). These do
not require Firebase and currently all pass. There are no integration
tests against Firestore -- that would require the Firebase Emulator Suite,
which could not be run in this repository's development sandbox (see
Known Limitations).

## Security

`firestore.rules` is a draft: role-based, project-assignment-scoped access
control consistent with the Firestore Security Design
(`docs/07_Security_Design/`), including source-role validation on Cost
Transactions (no impersonation) and read-only access for BOD. It has not
been reviewed by a second engineer, deployed, or tested against the
emulator. Treat it as a starting point for review, not an approved policy.

## Known Limitations

- No Firebase project or emulator has ever been exercised in this
  repository's development history. The Firestore-backed repository code
  compiles and is structurally complete for `users`, `projects`, and all
  project subcollections plus Cost Control, but has zero real read/write
  verification. The Firebase Local Emulator Suite could not be installed
  in this sandbox (its binary download is blocked by network egress
  rules), and no live Firebase project/credentials exist for SPMS.
- The generic contractual `milestones` timeline (per-phase schedule in
  Work Structure) has no Firestore-backed implementation yet -- mock-only.
- Progress History snapshots are only recorded when a project's detail
  page is visited; there is no scheduled/background snapshot job, so the
  Dashboard S-Curve and Monthly Report "Start of Month" figures may be
  sparse for projects that haven't been opened recently.
- A handful of pre-existing MUI + React 19 console warnings
  (`justifyContent`/`alignItems` props not applying as CSS on `<Stack>`
  when passed outside `sx`) remain in a few older files not touched by
  recent sprints; fixed everywhere the Dashboard/Project Master/Cost
  Control actually render.
- User deactivation is enforced at sign-in time, not in real time -- a
  user deactivated while already logged in elsewhere is not force-logged-
  out until their session's auth state next changes.

## Design notes

The visual identity is built around a "progress arc" motif -- a radial
dial used as the brand mark in the sidebar/login screen and as the
loading indicator. Palette is a graphite/slate base with a desaturated
solar-gold accent and a teal signal color. Dark mode is the primary mode;
light mode is fully supported via the toggle in the Topbar.
