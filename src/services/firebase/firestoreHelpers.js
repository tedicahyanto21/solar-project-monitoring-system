// Generic Firestore CRUD helpers (Sprint FT-8, Part D).
//
// Every Firebase-backed repository (userService, projectService, etc.)
// calls these instead of writing its own getDocs/setDoc boilerplate --
// this is the ONE place that talks to the Firestore SDK directly, so
// error handling (Part H) and query patterns stay consistent everywhere.
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, orderBy, writeBatch,
} from 'firebase/firestore';
import { db } from './config';

// Part H: never surface raw Firebase errors to the UI -- translate to a
// safe, generic message and log the technical detail for diagnostics only.
export class FirestoreOperationError extends Error {
  constructor(action, cause) {
    super(`Could not ${action}. Please try again, or contact an administrator if this continues.`);
    this.name = 'FirestoreOperationError';
    this.cause = cause;
  }
}

function guard(action, fn) {
  return fn().catch((err) => {
    console.error(`Firestore ${action} failed:`, err);
    throw new FirestoreOperationError(action, err);
  });
}

export async function getAllDocs(path, ...queryConstraints) {
  return guard(`read ${path}`, async () => {
    const ref = collection(db, ...path.split('/'));
    const snap = await getDocs(queryConstraints.length ? query(ref, ...queryConstraints) : ref);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}

export async function getOneDoc(path, id) {
  return guard(`read ${path}/${id}`, async () => {
    const ref = doc(db, ...path.split('/'), id);
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  });
}

export async function createDoc(path, data, id) {
  return guard(`create in ${path}`, async () => {
    if (id) {
      const ref = doc(db, ...path.split('/'), id);
      await setDoc(ref, data);
      return { id, ...data };
    }
    const ref = collection(db, ...path.split('/'));
    const created = await addDoc(ref, data);
    return { id: created.id, ...data };
  });
}

export async function updateDocById(path, id, patch) {
  return guard(`update ${path}/${id}`, async () => {
    const ref = doc(db, ...path.split('/'), id);
    await updateDoc(ref, patch);
    return getOneDoc(path, id);
  });
}

// Master Prompt #4 corrective: a document reference, exposed so a caller
// can batch multiple writes across paths/collections into one atomic unit
// (see docRef/newBatch/commitBatch below) instead of the sequential
// createDoc/updateDocById calls above, which cannot be combined atomically.
export function docRef(path, id) {
  return doc(db, ...path.split('/'), id);
}

export function newBatch() {
  return writeBatch(db);
}

export async function commitBatch(batch) {
  return guard('commit batch write', () => batch.commit());
}

export { where, orderBy };
