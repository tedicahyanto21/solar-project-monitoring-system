// Firestore-backed User Profile service (Sprint FT-8, Parts C/D).
//
// users/{userId} shape matches Database Design SPMS-DOC-06, Section 4 and
// the mock equivalent in src/data/mockUsers.js: userId, firebaseUid, name,
// email, role, department, status, createdAt, updatedAt. The Firestore
// document ID IS the userId (and, by convention, the Firebase Auth UID --
// see the note on createUser below); firebaseUid is also stored as an
// explicit field for clarity and to allow a profile to be provisioned
// before the person's first login.
import { getAllDocs, getOneDoc, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS } from './firestorePaths';

// getOneDoc/getAllDocs return a generic `id` field; map it to `userId` here
// so callers see the same shape as the mock repository.
function toUser(doc) {
  if (!doc) return null;
  const { id, ...rest } = doc;
  return { userId: id, ...rest };
}

// Part C: reads the SPMS profile for an authenticated Firebase user. This
// is the ONLY place role/status are resolved for a logged-in user -- the
// Firebase UID itself is never treated as a role. Returns null if no
// profile document exists -- callers (AuthContext) must treat that as
// "access denied", never as a default role.
export async function getUserProfile(firebaseUid) {
  return toUser(await getOneDoc(COLLECTIONS.USERS, firebaseUid));
}

export async function getUsers() {
  return (await getAllDocs(COLLECTIONS.USERS)).map(toUser);
}

export async function getUserById(userId) {
  return toUser(await getOneDoc(COLLECTIONS.USERS, userId));
}

// A1: creation authority (SUPER_ADMIN only) is enforced by the caller
// (userRepository / UI), not here. The document ID is set to `firebaseUid`
// when provided (so the person can log in immediately), or a generated ID
// otherwise (for a profile provisioned ahead of the person's first login,
// to be linked once they authenticate for the first time).
export async function createUser({ firebaseUid, name, email, role, department }) {
  const now = new Date().toISOString();
  const data = { firebaseUid: firebaseUid || null, name, email, role, department: department || '', status: 'ACTIVE', createdAt: now, updatedAt: now };
  return toUser(await createDoc(COLLECTIONS.USERS, data, firebaseUid));
}

export async function updateUser(userId, patch) {
  return toUser(await updateDocById(COLLECTIONS.USERS, userId, { ...patch, updatedAt: new Date().toISOString() }));
}

// A2: normal workflow is ACTIVE/INACTIVE toggling, never physical deletion.
export async function setUserStatus(userId, status) {
  return updateUser(userId, { status });
}
