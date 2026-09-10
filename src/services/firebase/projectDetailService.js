// Firestore-backed Project Detail subcollections service.
//
// Mirrors src/data/mockOperationalData.js's per-project subcollections:
// projectAssignments, progressHistory, engineeringDocuments, hseItems,
// procurementMilestones, constructionActivities, commissioningItems.
// Shape matches Database Design SPMS-DOC-06 and the FT-8 collection
// architecture (firestorePaths.js).
import { getAllDocs, getOneDoc, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS, PROJECT_SUBCOLLECTIONS } from './firestorePaths';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from './config';

function subPath(projectId, subcollection) {
  return `${COLLECTIONS.PROJECTS}/${projectId}/${subcollection}`;
}

// --- Assignments -----------------------------------------------------------
// Document ID is the userId (projects/{projectId}/projectAssignments/{userId}).
export async function getAssignments(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.ASSIGNMENTS));
}

export async function assignUser(projectId, role, { userId, name }, assignedBy) {
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.ASSIGNMENTS);
  const existing = await getAllDocs(path);
  const current = existing.find((a) => a.role === role);
  const data = { role, userId, name, assignedAt: new Date().toISOString(), assignedBy };
  if (current) {
    await updateDocById(path, current.id, data);
  } else {
    await createDoc(path, data, userId);
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

// FT-5 A6: same validation as the mock store -- negative rejected, planned
// quantity of zero guarded, history appended (never overwritten).
export async function updateConstructionActivity(projectId, activityId, { actualQuantity, date }) {
  if (actualQuantity < 0) throw new Error('Actual Quantity cannot be negative.');
  const path = subPath(projectId, PROJECT_SUBCOLLECTIONS.CONSTRUCTION_ACTIVITIES);
  const activity = await getOneDoc(path, activityId);
  if (!activity) return null;
  if (activity.plannedQuantity <= 0) throw new Error('Planned Quantity must be greater than zero before Actual Quantity can be recorded.');
  const entryDate = date || new Date().toISOString().slice(0, 10);
  const existingSameDay = (activity.history || []).find((h) => h.date === entryDate);
  const history = existingSameDay
    ? activity.history.map((h) => (h.date === entryDate ? { date: entryDate, actualQuantity } : h))
    : [...(activity.history || []), { date: entryDate, actualQuantity }];
  return updateDocById(path, activityId, { actualQuantity, history, updatedAt: new Date().toISOString() });
}

// --- Commissioning items -----------------------------------------------------
export async function getCommissioningChecklist(projectId) {
  return getAllDocs(subPath(projectId, PROJECT_SUBCOLLECTIONS.COMMISSIONING_ITEMS));
}
