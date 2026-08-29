// Repository layer for User Management (Database Design SPMS-DOC-06,
// Section 4 -- users/{userId}; Sprint FT-7 CRUD finalization; Sprint FT-8
// Firebase readiness).
//
// FT-8 Part F (migration strategy): this file is the ONE place that
// decides which backend is authoritative. Every function branches on
// `isLocalMode` and delegates to either the mock store or the Firestore
// service -- callers never know or care which one is active, and the two
// backends are never both "live" at once for a given call.
import { isLocalMode } from '../firebase/config';
import * as mockUsers from '../../data/mockUsers';
import * as firebaseUsers from '../firebase/userService';

// Part C: used by AuthContext to resolve the SPMS profile for an
// authenticated Firebase user. In LOCAL MODE there is no real Firebase
// UID, so this is not meaningfully called there (AuthContext short-
// circuits with LOCAL_USER); exported for interface completeness.
export async function getUserProfile(firebaseUid) {
  return firebaseUsers.getUserProfile(firebaseUid);
}

export async function getUsers() {
  return isLocalMode ? mockUsers.getUsers() : firebaseUsers.getUsers();
}

export async function getUserById(userId) {
  return isLocalMode ? mockUsers.getUserById(userId) : firebaseUsers.getUserById(userId);
}

// A1: creation authority (SUPER_ADMIN only) is enforced by the caller --
// this function performs the write, it does not itself authorize it.
export async function createUser(user) {
  return isLocalMode ? mockUsers.createUser(user) : firebaseUsers.createUser(user);
}

export async function updateUser(userId, patch) {
  return isLocalMode ? mockUsers.updateUser(userId, patch) : firebaseUsers.updateUser(userId, patch);
}

// A2: normal workflow is ACTIVE/INACTIVE toggling, never physical deletion.
export async function setUserStatus(userId, status) {
  return isLocalMode ? mockUsers.setUserStatus(userId, status) : firebaseUsers.setUserStatus(userId, status);
}

// Part C: assignment eligibility check -- exists, ACTIVE, and holds the
// role being assigned. Centralized here so both the Team Assignment UI and
// the assignment repository call the SAME rule (no duplicated validation),
// regardless of which backend is active.
export async function validateAssignable(userId, requiredRole) {
  const user = await getUserById(userId);
  if (!user) return { ok: false, reason: 'Selected user does not exist.' };
  if (user.status !== 'ACTIVE') return { ok: false, reason: `${user.name} is INACTIVE and cannot be assigned.` };
  if (user.role !== requiredRole) return { ok: false, reason: `${user.name} holds the ${user.role} role, not ${requiredRole}.` };
  return { ok: true, user };
}
