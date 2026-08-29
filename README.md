# SPMS — Solar Project Monitoring System

Reusable boilerplate for Solar EPC Project Execution Management. Provides
the app shell (auth, routing, layout, theme) with placeholder modules ready
to be built out.

## Current scope (boilerplate)

- Project architecture & folder structure
- Firebase configuration (Auth, Firestore, Storage)
- Routing (`react-router-dom`, protected routes, 404 handling)
- Authentication (email/password sign-in)
- App shell: collapsible Sidebar + Topbar
- Login page
- Placeholder pages: Dashboard, Projects, Settings

Dashboard, Projects, and Settings are intentionally placeholder screens —
each displays a "Coming Soon" message until its module is implemented.

## Tech stack

React 19 + Vite · Material UI · React Router · React Hook Form · Firebase
(Auth/Firestore/Storage)

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your Firebase project config
npm run dev
```

### Firebase setup

1. Create a project at https://console.firebase.google.com
2. Enable **Authentication > Email/Password**
3. Create a **Cloud Firestore** database
4. In Project settings > General, register a Web App and copy the config
   values into `.env`
5. Create at least one user in Authentication, then add a matching document
   in Firestore at `users/{uid}` with shape:
   ```json
   { "displayName": "Jane Doe", "role": "project_manager", "team": "PE" }
   ```
   (the app falls back gracefully if this document doesn't exist yet)

## Folder structure

```
src/
├── pages/
│   ├── Login/
│   ├── Dashboard/
│   ├── Projects/
│   ├── Settings/
│   └── NotFound/
├── layouts/           # MainLayout, Sidebar, Topbar
├── hooks/
├── services/
│   └── firebase/      # config.js, authService.js, userService.js
├── context/           # AuthContext, ThemeModeContext
├── routes/            # AppRoutes, ProtectedRoute
├── theme/             # tokens.js, createAppTheme.js
├── utils/
├── components/
│   └── common/        # ProgressArc (shared brand mark / spinner)
└── constants/          # nav.js
```

## Design notes

The visual identity is built around a "progress arc" motif — a radial dial
used as the brand mark in the sidebar/login screen and as the loading
indicator. Palette is a graphite/slate base with a desaturated solar-gold
accent and a teal signal color, aimed at reading like a monitoring tool
rather than a generic SaaS template. Dark mode is the primary mode; light
mode is fully supported via the toggle in the Topbar.

## Next

Projects module: create/list/detail views, Firestore schema for solar
project sites and milestones, and wiring the Dashboard to real progress
data.
