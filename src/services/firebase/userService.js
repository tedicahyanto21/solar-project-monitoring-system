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
import { createUserAccount, deleteJustCreatedUserAccount, endProvisioningSession, generateTemporaryPassword } from './authService';

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
// (userRepository / UI), not here.
//
// ROOT CAUSE FIX: this previously accepted a `firebaseUid` parameter that
// nothing ever actually supplied, so profiles were created with
// firebaseUid: null and no matching Authentication account -- the new
// user could never log in. The correct order is:
//
//   1. Create the REAL Firebase Authentication account (on the isolated
//      provisioning auth instance -- see authService.createUserAccount /
//      config.getProvisioningAuth -- so the currently signed-in Super
//      Admin's own session is never replaced).
//   2. Use the UID Firebase Authentication actually returns.
//   3. Create users/{thatRealUid} in Firestore.
//
// The generated temporary password is returned ONCE so the caller
// (UsersPage) can show it to Super Admin to pass on securely -- it is
// never written to Firestore or logged.
export async function createUser({ name, email, role, department }) {
  const temporaryPassword = generateTemporaryPassword();

  let authUser;
  try {
    authUser = await createUserAccount(email, temporaryPassword, name);
  } catch (err) {
    await endProvisioningSession().catch(() => {});
    throw new Error(`Could not create the Authentication account: ${err.message}`);
  }

  const firebaseUid = authUser.uid;
  const now = new Date().toISOString();
  const data = { firebaseUid, name, email, role, department: department || '', status: 'ACTIVE', createdAt: now, updatedAt: now };

  try {
    const created = toUser(await createDoc(COLLECTIONS.USERS, data, firebaseUid));
    await endProvisioningSession();
    return { ...created, temporaryPassword };
  } catch (err) {
    // Requirement #3: do not silently report success. The Authentication
    // account now exists with no matching profile -- roll it back rather
    // than leave an inconsistent orphan.
    try {
      await deleteJustCreatedUserAccount();
      await endProvisioningSession();
      throw new Error(`The account could not be fully created and was automatically rolled back: ${err.message}. Please try again.`);
    } catch (rollbackErr) {
      await endProvisioningSession().catch(() => {});
      throw new Error(
        `CRITICAL: an Authentication account (UID: ${firebaseUid}) was created but the Firestore profile failed, and automatic rollback ALSO failed (${rollbackErr.message}). ` +
        `This account must be manually deleted from the Firebase Console -> Authentication before "${email}" can be provisioned again. Original error: ${err.message}`
      );
    }
  }
}

export async function updateUser(userId, patch) {
  return toUser(await updateDocById(COLLECTIONS.USERS, userId, { ...patch, updatedAt: new Date().toISOString() }));
}

// A2: normal workflow is ACTIVE/INACTIVE toggling, never physical deletion.
export async function setUserStatus(userId, status) {
  return updateUser(userId, { status });
}
