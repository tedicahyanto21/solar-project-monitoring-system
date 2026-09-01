// Firestore-backed Project service (Sprint FT-8 Parts D/E; Sprint FT-9A
// write path). projects/{projectId} shape matches Database Design
// SPMS-DOC-06, Section 5. The Firestore document ID is the projectId --
// never a random Firestore auto-ID (Sprint FT-9A, Section 5).
import { serverTimestamp } from 'firebase/firestore';
import { getAllDocs, getOneDoc, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS } from './firestorePaths';

function toProject(d) {
  if (!d) return null;
  const { id, ...rest } = d;
  return { id, projectId: id, ...rest };
}

export async function getProjects() {
  return (await getAllDocs(COLLECTIONS.PROJECTS)).map(toProject);
}

export async function getProjectById(projectId) {
  return toProject(await getOneDoc(COLLECTIONS.PROJECTS, projectId));
}

// Sprint FT-9A, Section 9 (duplicate protection): projectId IS the
// document ID, so createDoc(..., projectId) would silently OVERWRITE an
// existing project via setDoc if we didn't check first. This existence
// check is the actual duplicate-protection mechanism -- it is not
// optional and must run before every create.
export async function createProject(projectId, projectData) {
  const existing = await getOneDoc(COLLECTIONS.PROJECTS, projectId);
  if (existing) {
    const err = new Error(`A project with ID "${projectId}" already exists. Choose a different Project Code.`);
    err.code = 'DUPLICATE_PROJECT';
    throw err;
  }
  // Section 6: createdAt/updatedAt are both set to a server timestamp at
  // creation; createdAt is never touched again after this.
  const data = { ...projectData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  return toProject(await createDoc(COLLECTIONS.PROJECTS, data, projectId));
}

// Sprint FT-9A, Section 10: targeted update. Firestore's updateDoc (used
// by updateDocById) only touches the fields present in `patch` -- it does
// not replace the whole document -- so fields not included here
// (assignments, progress history, subcollections, other master fields)
// are structurally untouched, not just "hopefully" preserved.
//
// Section 6: createdAt is stripped from the incoming patch so it can never
// be overwritten by an update, no matter what the caller passes in.
export async function updateProject(projectId, patch) {
  const existing = await getOneDoc(COLLECTIONS.PROJECTS, projectId);
  if (!existing) {
    const err = new Error(`Project "${projectId}" was not found.`);
    err.code = 'PROJECT_NOT_FOUND';
    throw err;
  }
  const safePatch = sanitizeUpdatePatch(patch);
  return toProject(await updateDocById(COLLECTIONS.PROJECTS, projectId, { ...safePatch, updatedAt: serverTimestamp() }));
}

// Pure, Firebase-free logic (exported so it can be unit tested without any
// Firestore connection -- see projectService.test.js): removes identity
// fields (id/projectId) and createdAt from an update patch, and drops any
// `undefined` values (the Firestore SDK throws on undefined field values).
export function sanitizeUpdatePatch(patch) {
  const { id: _id, projectId: _projectId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = patch || {};
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
}
