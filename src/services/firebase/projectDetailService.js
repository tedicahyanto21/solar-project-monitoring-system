// Firestore-backed Project Detail subcollections service.
//
// Mirrors src/data/mockOperationalData.js's per-project subcollections:
// projectAssignments, progressHistory, engineeringDocuments, hseItems,
// procurementMilestones, constructionActivities, commissioningItems.
// Shape matches Database Design SPMS-DOC-06 and the FT-8 collection
// architecture (firestorePaths.js).
import { getAllDocs, getOneDoc, createDoc, updateDocById, deleteDocById, FirestoreOperationError } from './firestoreHelpers';
import { COLLECTIONS, PROJECT_SUBCOLLECTIONS } from './firestorePaths';
import { doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from './config';

function subPath(projectId, subcollection) {
  return `${COLLECTIONS.PROJECTS}/${projectId}/${subcollection}`;
}

// --- Assignments -----------------------------------------------------------
// Document ID is the userId (projects/{projectId}/projectAssignments/{userId}).
export async function getAssignments(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.ASSIGNMENTS));
}

// C-01A: identity-based (role + userId), additive assignment -- the same
// fix as mockOperationalData.assignUser, and it SUPERSEDES the MP#4
// Corrective "find by role, delete old ID, create new ID" logic entirely:
// by keying the lookup on (role, userId) together instead of role alone,
// this function never finds "some other user's" document to reassign in
// the first place, so the document-ID-===-userId invariant holds by
// construction, with no delete-then-recreate dance needed for the general
// case. A DIFFERENT user for a role that currently only has an
// "Unassigned" placeholder (the seed convention for an empty slot)
// replaces that placeholder; a DIFFERENT user for a role some OTHER real
// user already holds gets an ADDITIONAL document -- the existing user's
// assignment is left completely untouched, enabling multiple
// SITE_MANAGER/ENGINEERING/HSE holders per project.
//
// PROJECT_MANAGER never reaches this function -- projectDetailRepository
// routes PM assignment through the separate, atomic setProjectManager()
// below instead, which keeps its own single-PM-per-project invariant
// untouched by this change.
export async function assignUser(projectId, role, { userId, name }, assignedBy) {
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.ASSIGNMENTS);
  const existing = await getAllDocs(path);
  const now = new Date().toISOString();
  const sameUserSameRole = existing.find((a) => a.role === role && a.id === userId);
  if (sameUserSameRole) {
    await updateDocById(path, userId, { role, userId, name, assignedAt: now, assignedBy });
  } else {
    const placeholder = existing.find((a) => a.role === role && a.name === 'Unassigned');
    if (placeholder) {
      await deleteDocById(path, placeholder.id);
    }
    await createDoc(path, { role, userId, name, assignedAt: now, assignedBy }, userId);
  }
  return getAllDocs(path);
}

// C-01A: remove one specific (role, userId) assignment -- the counterpart
// to the additive assignUser above. Never used for PROJECT_MANAGER.
export async function removeAssignment(projectId, role, userId) {
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.ASSIGNMENTS);
  const existing = await getAllDocs(path);
  const target = existing.find((a) => a.role === role && a.id === userId);
  if (target) {
    await deleteDocById(path, target.id);
  }
  return getAllDocs(path);
}

// MP#4 Corrective Fix, Section 8: PM reassignment touches two related
// documents (the projectAssignments record and projects/{id}.
// projectManagerId) -- this performs both as ONE atomic writeBatch commit,
// using the SDK's existing batch primitive (no new infrastructure layer).
// Either both writes land or neither does; there is no window where one
// side reflects the new PM and the other still reflects the old one.
export async function setProjectManager(projectId, { userId, name }, assignedBy) {
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.ASSIGNMENTS);
  const existing = await getAllDocs(path);
  const current = existing.find((a) => a.role === 'PROJECT_MANAGER');
  const now = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    if (current && current.id !== userId) {
      batch.delete(doc(db, ...path.split('/'), current.id));
    }
    batch.set(doc(db, ...path.split('/'), userId), {
      role: 'PROJECT_MANAGER', userId, name, assignedAt: now, assignedBy,
    });
    batch.update(doc(db, COLLECTIONS.PROJECTS, projectId), {
      projectManagerId: userId, projectManager: name, updatedAt: now,
    });
    await batch.commit();
  } catch (err) {
    console.error('Firestore atomic PM assignment failed:', err);
    throw new FirestoreOperationError('assign Project Manager', err);
  }

  return getAllDocs(path);
}

// --- Progress weights ---------------------------------------------------------
// Stored as a field on the project document itself (same pattern as
// costService.getPlannedCost/setPlannedCost for plannedCost) rather than a
// new collection -- Master Prompt #2, Section 13: "prefer an existing
// canonical project document field... document the decision." progressWeights
// is a small, project-level configuration value, not a growing operational
// record, so it belongs on the project doc rather than a subcollection.
export async function getProjectWeights(projectId) {
  const snap = await getDoc(doc(db, COLLECTIONS.PROJECTS, projectId));
  return snap.exists() ? (snap.data().progressWeights ?? null) : null;
}

export async function setProjectWeights(projectId, weights) {
  await updateDoc(doc(db, COLLECTIONS.PROJECTS, projectId), { progressWeights: weights });
  return weights;
}

// --- Progress history --------------------------------------------------------
export async function getProgressHistory(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.PROGRESS_HISTORY));
}

// One doc per calendar day -- snapshotDate is the document ID so re-saving
// the same day updates rather than duplicates (Sprint FT-5 A9).
export async function recordProgressSnapshot(projectId, { snapshotDate, plannedProgress, actualProgress, source }) {
  const date = snapshotDate || new Date().toISOString().slice(0, 10);
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.PROGRESS_HISTORY);
  return createDoc(path, { projectId, snapshotDate: date, plannedProgress, actualProgress, source: source || 'progressRepository' }, date);
}

// --- Engineering documents -----------------------------------------------------
export async function getEngineeringDocuments(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.ENGINEERING_DOCUMENTS));
}

export async function addEngineeringDocument(projectId, doc) {
  return createDoc(subPath(projectId, PROJECT_SUBCOLLECTIONS.ENGINEERING_DOCUMENTS), doc);
}

export async function updateEngineeringDocument(projectId, docId, patch) {
  return updateDocById(subPath(projectId, PROJECT_SUBCOLLECTIONS.ENGINEERING_DOCUMENTS), docId, patch);
}

// --- HSE items -------------------------------------------------------------
export async function getHseDocuments(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.HSE_ITEMS));
}

export async function addHseDocument(projectId, doc) {
  return createDoc(subPath(projectId, PROJECT_SUBCOLLECTIONS.HSE_ITEMS), doc);
}

export async function updateHseDocument(projectId, docId, patch) {
  return updateDocById(subPath(projectId, PROJECT_SUBCOLLECTIONS.HSE_ITEMS), docId, patch);
}

// --- Procurement milestones -----------------------------------------------------
export async function getProcurementMilestones(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.PROCUREMENT_MILESTONES));
}

export async function createProcurementMilestone(projectId, milestone) {
  return createDoc(subPath(projectId, PROJECT_SUBCOLLECTIONS.PROCUREMENT_MILESTONES), { status: 'Not Started', progressContribution: 0, actualDate: null, ...milestone });
}

export async function updateProcurementMilestone(projectId, milestoneId, patch) {
  return updateDocById(subPath(projectId, PROJECT_SUBCOLLECTIONS.PROCUREMENT_MILESTONES), milestoneId, patch);
}

// --- Construction activities -----------------------------------------------------
// Master Prompt #3: PLAN (create/updatePlan) and ACTUAL (update) are two
// explicit, separate functions -- never one unrestricted update. This
// mirrors the same separation in mockOperationalData.js and is what keeps
// the Firestore rule's field-level restriction (constructionActivities:
// PROJECT_MANAGER may only touch PLAN fields, SITE_MANAGER only ACTUAL
// fields) actually satisfiable by the application code that calls it.
export async function getConstructionActivities(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.CONSTRUCTION_ACTIVITIES));
}

export async function createConstructionActivity(projectId, { activity, plannedQuantity, unit, weight }) {
  if (!(plannedQuantity > 0)) throw new Error('Planned Quantity must be greater than zero.');
  return createDoc(subPath(projectId, PROJECT_SUBCOLLECTIONS.CONSTRUCTION_ACTIVITIES), {
    activity, plannedQuantity, unit, weight, actualQuantity: 0, history: [], updatedAt: new Date().toISOString(),
  });
}

export async function updateConstructionActivityPlan(projectId, activityId, { activity, plannedQuantity, unit, weight }) {
  if (plannedQuantity !== undefined && !(plannedQuantity > 0)) throw new Error('Planned Quantity must be greater than zero.');
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.CONSTRUCTION_ACTIVITIES);
  const patch = { updatedAt: new Date().toISOString() };
  if (activity !== undefined) patch.activity = activity;
  if (plannedQuantity !== undefined) patch.plannedQuantity = plannedQuantity;
  if (unit !== undefined) patch.unit = unit;
  if (weight !== undefined) patch.weight = weight;
  return updateDocById(path, activityId, patch);
}

// C-01B: same daily-to-cumulative model as the mock store -- the caller
// supplies dailyQuantity (the day's own quantity), never the running
// total. actualQuantity is always computed here as SUM(history.
// dailyQuantity), with the same legacy-entry safety net as the mock
// store's computeCumulativeFromHistory: a pre-C-01B history entry (which
// has `actualQuantity`, a cumulative snapshot, and no `dailyQuantity`) is
// never summed directly -- the LAST such entry is treated as a one-time
// starting baseline, and only `dailyQuantity` entries are summed on top of
// it. Negative rejected, zero planned-quantity guarded, same-date entries
// REPLACE (never duplicate or add to) that day's value -- all unchanged
// business rules from FT-5 A6 / C-01B's fixed same-date decision.
// C-01B Corrective: same fixes as the mock store's updateConstructionActivity /
// computeCumulativeFromHistory --
// Fix #1: legacy baseline is the LATEST legacy snapshot BY DATE, not the
// numerically largest one.
// Fix #2: a same-date lookup only ever matches an existing NEW-style
// (dailyQuantity) entry -- never a legacy {date, actualQuantity} snapshot
// that happens to share the date, which would otherwise be silently
// overwritten and destroy its baseline value.
export async function updateConstructionActivity(projectId, activityId, { dailyQuantity, date }) {
  if (dailyQuantity < 0) throw new Error('Actual Quantity cannot be negative.');
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.CONSTRUCTION_ACTIVITIES);
  const activity = await getOneDoc(path, activityId);
  if (!activity) return null;
  if (activity.plannedQuantity <= 0) throw new Error('Planned Quantity must be greater than zero before Actual Quantity can be recorded.');
  const entryDate = date || new Date().toISOString().slice(0, 10);
  // C-01B Small Corrective: Daily Actual date must be >= the latest legacy
  // snapshot's date -- see the mock store's identical validation for the
  // rationale (backdating before that point would double-count progress
  // the legacy cumulative snapshot already accounted for). The submitted
  // date is never modified, only rejected when invalid.
  const preExistingLegacyEntries = (activity.history || []).filter((h) => h.dailyQuantity === undefined && h.actualQuantity !== undefined);
  const latestPreExistingLegacyEntry = preExistingLegacyEntries.reduce((latest, h) => (!latest || h.date > latest.date ? h : latest), null);
  if (latestPreExistingLegacyEntry && entryDate < latestPreExistingLegacyEntry.date) {
    throw new Error('Daily Actual date cannot be earlier than the latest legacy actual date.');
  }
  const existingDailyEntry = (activity.history || []).find((h) => h.date === entryDate && h.dailyQuantity !== undefined);
  const history = existingDailyEntry
    ? activity.history.map((h) => (h === existingDailyEntry ? { date: entryDate, dailyQuantity } : h))
    : [...(activity.history || []), { date: entryDate, dailyQuantity }];
  const legacyEntries = history.filter((h) => h.dailyQuantity === undefined && h.actualQuantity !== undefined);
  const dailyEntries = history.filter((h) => h.dailyQuantity !== undefined);
  const latestLegacyEntry = legacyEntries.reduce((latest, h) => (!latest || h.date > latest.date ? h : latest), null);
  const legacyBaseline = latestLegacyEntry ? latestLegacyEntry.actualQuantity : 0;
  const actualQuantity = legacyBaseline + dailyEntries.reduce((sum, h) => sum + h.dailyQuantity, 0);
  return updateDocById(path, activityId, { actualQuantity, history, updatedAt: new Date().toISOString() });
}

// --- Commissioning items -----------------------------------------------------
export async function getCommissioningChecklist(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.COMMISSIONING_ITEMS));
}
