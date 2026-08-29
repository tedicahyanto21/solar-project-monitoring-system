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

export { auth, db, storage };
export default app;
