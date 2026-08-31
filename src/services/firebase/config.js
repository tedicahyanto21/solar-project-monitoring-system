import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// All values come from environment variables — see .env.example.
// Never hardcode Firebase credentials in source.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// --- LOCAL MODE adapter -------------------------------------------------
// Firebase integration is implemented in Milestone 3. Until then, the app
// must be able to run without a configured Firebase project.
//
// If any required config value is missing — or if Firebase fails to
// initialize for any other reason — the app switches into LOCAL MODE:
// initializeApp(), getAuth(), getFirestore(), and getStorage() are never
// called, and auth/db/storage below become safe `null` stand-ins instead
// of throwing at runtime. Firebase files, imports, and the dependency
// itself are left in place for Milestone 3.
const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const hasRequiredConfig = REQUIRED_KEYS.every((key) => Boolean(firebaseConfig[key]));

export let isLocalMode = !hasRequiredConfig;

let app = null;
let auth = null;
let db = null;
let storage = null;

if (hasRequiredConfig) {
  try {
    // Guard against re-initializing during Vite HMR
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  } catch (err) {
    console.warn('Firebase initialization failed — falling back to LOCAL MODE.', err);
    isLocalMode = true;
    app = null;
    auth = null;
    db = null;
    storage = null;
  }
}

if (isLocalMode) {
  // eslint-disable-next-line no-console
  console.log('Running in LOCAL MODE');
}

// --- Secondary app instance for User Provisioning ---------------------------
// Firebase's client Auth SDK signs the CURRENT app instance in as whichever
// user was just created/signed-in on it. If Super Admin used the PRIMARY
// `auth` above to call createUserWithEmailAndPassword() for a new user,
// Super Admin's own session would be silently replaced by the new user's
// session -- a well-documented Firebase client SDK behavior, not a bug.
//
// The standard, backend-free fix: run user creation on a SECOND, isolated
// FirebaseApp instance (same project config, different app name). Each
// FirebaseApp has its own independent Auth state, so creating a user there
// never touches the PRIMARY app's current session. No Admin SDK or
// privileged credentials are involved -- this still uses the same public
// client config already in `.env`. See services/firebase/authService.js
// (createUserAccount) for where this is actually used.
//
// The secondary app is created lazily (only when a user is actually being
// provisioned) and is a distinct, guarded code path from `app`/`auth` above
// so LOCAL MODE and normal login/logout are entirely unaffected.
let provisioningApp = null;
export function getProvisioningAuth() {
  if (isLocalMode) {
    throw new Error('User provisioning against Firebase Authentication is not available in LOCAL MODE.');
  }
  if (!provisioningApp) {
    const name = 'spms-user-provisioning';
    provisioningApp = getApps().find((a) => a.name === name) || initializeApp(firebaseConfig, name);
  }
  return getAuth(provisioningApp);
}

export { auth, db, storage };
export default app;
