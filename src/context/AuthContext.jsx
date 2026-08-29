import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeToAuthChanges, loginWithEmail, logout as firebaseLogout } from '../services/firebase/authService';
import { getUserProfile } from '../services/firebase/userService';
import { isLocalMode } from '../services/firebase/config';
import { ROLES } from '../constants/roles';

const AuthContext = createContext(undefined);

// Dummy identity used while running in LOCAL MODE (no Firebase project
// configured). Firebase Authentication is wired up in Milestone 3 — until
// then the user is treated as already logged in.
//
// role defaults to SUPER_ADMIN so every module is visible during local
// development. Once Firebase is configured, the real role always comes
// from the user's Firestore profile (see userService.getUserProfile) —
// this default has no effect outside LOCAL MODE.
const LOCAL_USER = {
  id: 'local-user',
  uid: 'local-user',
  name: 'Development User',
  displayName: 'Development User',
  email: 'developer@localhost',
  role: ROLES.SUPER_ADMIN,
  status: 'ACTIVE',
};

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(isLocalMode ? LOCAL_USER : null);
  const [profile, setProfile] = useState(isLocalMode ? LOCAL_USER : null);
  const [initializing, setInitializing] = useState(!isLocalMode);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isLocalMode) {
      // Firebase is disabled — skip Authentication entirely.
      setInitializing(false);
      return;
    }

    const unsubscribe = subscribeToAuthChanges(async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const userProfile = await getUserProfile(user.uid);
          // Part C: an authenticated Firebase user with no SPMS profile, or
          // whose profile is INACTIVE, must be denied access -- never
          // silently treated as authenticated with a default role. Signing
          // them back out prevents a half-authenticated state where
          // `firebaseUser` is set but there is nothing safe to grant.
          if (!userProfile) {
            console.error(`No SPMS user profile found for Firebase UID ${user.uid}.`);
            setError('Your account is not yet set up in SPMS. Contact an administrator.');
            setProfile(null);
            await firebaseLogout();
          } else if (userProfile.status !== 'ACTIVE') {
            setError('Your account has been deactivated. Contact an administrator.');
            setProfile(null);
            await firebaseLogout();
          } else {
            setError(null);
            setProfile(userProfile);
          }
        } catch (err) {
          // Part H: Firestore read failure while resolving the profile --
          // fail closed (no profile, no access), and never expose the raw
          // error to the user.
          console.error('Failed to load user profile', err);
          setError('Could not verify your account right now. Please try again.');
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setInitializing(false);
    });
    return unsubscribe;
  }, []);

  async function login(email, password) {
    if (isLocalMode) {
      // No-op in LOCAL MODE — the dummy user is already "logged in".
      return { success: true };
    }
    setError(null);
    try {
      await loginWithEmail(email, password);
      return { success: true };
    } catch (err) {
      const message = mapAuthError(err.code);
      setError(message);
      return { success: false, message };
    }
  }

  async function logout() {
    if (isLocalMode) return;
    await firebaseLogout();
  }

  const value = useMemo(
    () => ({
      user: firebaseUser,
      profile,
      // Part C: "authenticated" for application purposes means Firebase
      // Auth succeeded AND the SPMS profile was resolved as ACTIVE -- not
      // just a valid Firebase session. This closes the brief window right
      // after a fresh login where firebaseUser is already set but the
      // profile check (missing/INACTIVE -> auto sign-out) has not finished;
      // without this, a page could briefly treat the person as signed in
      // before being kicked back out.
      isAuthenticated: isLocalMode ? true : !!firebaseUser && !!profile,
      initializing,
      error,
      login,
      logout,
    }),
    [firebaseUser, profile, initializing, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function mapAuthError(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a few minutes.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    default:
      return 'Could not sign in. Check your connection and try again.';
  }
}
