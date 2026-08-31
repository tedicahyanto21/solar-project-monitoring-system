import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser,
} from 'firebase/auth';
import { auth, getProvisioningAuth } from './config';

export function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function subscribeToAuthChanges(callback) {
  return onAuthStateChanged(auth, callback);
}

// --- User Provisioning (Super Admin creating a new user) --------------------
// Runs on the SECONDARY app instance (see config.js:getProvisioningAuth) so
// this never touches the PRIMARY `auth` above -- the currently signed-in
// Super Admin's session is untouched by any of the three functions below.
//
// Returns the real Firebase Authentication UID. Callers (userService.js)
// use this UID as the Firestore users/{uid} document ID -- never a random
// or Firestore-generated ID.
export async function createUserAccount(email, password, displayName) {
  const provisioningAuth = getProvisioningAuth();
  const credential = await createUserWithEmailAndPassword(provisioningAuth, email, password);
  if (displayName) {
    try {
      await updateProfile(credential.user, { displayName });
    } catch (err) {
      // Non-fatal -- the account and UID are still valid without this.
      console.warn('Could not set displayName on newly created user:', err);
    }
  }
  return credential.user;
}

// Rollback for partial-failure handling: deletes the account just created
// above. This ONLY works while still signed in as that user on the
// provisioning auth instance (i.e., call this before endProvisioningSession
// below) -- the client SDK has no way to delete an arbitrary OTHER user
// without Admin SDK privileges, which this project deliberately does not
// place in the frontend.
export async function deleteJustCreatedUserAccount() {
  const provisioningAuth = getProvisioningAuth();
  if (provisioningAuth.currentUser) {
    await deleteUser(provisioningAuth.currentUser);
  }
}

// Always called after a provisioning attempt (success OR rollback) so the
// secondary app instance never holds a lingering signed-in session.
export async function endProvisioningSession() {
  const provisioningAuth = getProvisioningAuth();
  if (provisioningAuth.currentUser) {
    await signOut(provisioningAuth);
  }
}

// Secure temporary password for a newly provisioned account. The Super
// Admin is shown this once (UsersPage) to pass on to the new user through
// a secure channel -- it is never stored in Firestore or logged.
export function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
