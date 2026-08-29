// Repository for Project Master detail sub-collections (Database Design
// SPMS-DOC-06, Sections 6, 8-11): assignments, milestones, engineering
// documents, HSE documents, construction activities, commissioning
// checklist. Wraps the in-memory mock store today; shape matches the
// approved Firestore subcollections so this becomes a thin Firestore
// client later without changing callers.
import {
  getOperations,
  addEngineeringDocument,
  updateEngineeringDocument as storeUpdateEngineeringDocument,
  addHseDocument,
  updateHseDocument as storeUpdateHseDocument,
  createProcurementMilestone as storeCreateProcurementMilestone,
  updateProcurementMilestone as storeUpdateProcurementMilestone,
  updateConstructionActivity as storeUpdateConstructionActivity,
  assignUser as storeAssignUser,
} from '../../data/mockOperationalData';
import { validateAssignable } from './userRepository';

export async function getMilestones(projectId) {
  return getOperations(projectId)?.milestones ?? [];
}

export async function getEngineeringDocuments(projectId) {
  return getOperations(projectId)?.engineeringDocuments ?? [];
}

export async function createEngineeringDocument(projectId, doc) {
  return addEngineeringDocument(projectId, doc);
}

// FT-5 A3: authorized Engineering users maintain progressContribution on an
// EXISTING document over time -- this is the normal way progress is kept
// current, not just document creation.
export async function updateEngineeringDocument(projectId, docId, patch) {
  return storeUpdateEngineeringDocument(projectId, docId, patch);
}

export async function getHseDocuments(projectId) {
  return getOperations(projectId)?.hseDocuments ?? [];
}

export async function createHseDocument(projectId, doc) {
  return addHseDocument(projectId, doc);
}

// FT-5 A4: same principle as Engineering -- authorized HSE users update an
// existing item's progressContribution independently of its status.
export async function updateHseDocument(projectId, docId, patch) {
  return storeUpdateHseDocument(projectId, docId, patch);
}

export async function getProcurementMilestones(projectId) {
  return getOperations(projectId)?.procurementMilestones ?? [];
}

// FT-5 A5: milestones are configurable, not a hardcoded closed list --
// this is how a project adds one beyond the seeded defaults.
export async function createProcurementMilestone(projectId, milestone) {
  return storeCreateProcurementMilestone(projectId, milestone);
}

export async function updateProcurementMilestone(projectId, milestoneId, patch) {
  return storeUpdateProcurementMilestone(projectId, milestoneId, patch);
}

export async function getConstructionActivities(projectId) {
  return getOperations(projectId)?.constructionActivities ?? [];
}

// FT-5 A6: throws on negative Actual Quantity or a zero/negative Planned
// Quantity -- the caller (UI) is expected to catch and display this, not
// treat it as a bug. History is appended, never overwritten, by the store.
export async function updateConstructionActivity(projectId, activityId, { actualQuantity, date }) {
  return storeUpdateConstructionActivity(projectId, activityId, { actualQuantity, date });
}

export async function getCommissioningChecklist(projectId) {
  return getOperations(projectId)?.commissioningChecklist ?? [];
}

export async function getAssignments(projectId) {
  return getOperations(projectId)?.assignments ?? [];
}

// Assignment authority (Project Blueprint SPMS-DOC-05, Section 5; Sprint
// FT-4 Team Assignment rules) is enforced by the caller (UI checks the
// current user's role before calling this) -- this function performs the
// write, it does not itself authorize it. Real authorization happens in
// Firestore rules once that layer exists.
//
// FT-4.1 Correction 2: the assignment reference is userId, matching
// projects/{projectId}/assignments/{userId}. `name` is passed alongside
// purely as a denormalized display convenience -- callers must not use
// name as the identity of the assignment.
// FT-7 Part C: assignment eligibility (exists, ACTIVE, correct role) is
// validated HERE -- at the repository boundary -- not just filtered out of
// the UI picker. A caller that bypasses the UI still cannot create an
// invalid assignment; this throws rather than silently accepting one.
export async function assignUser(projectId, role, { userId, name }, assignedBy) {
  const check = await validateAssignable(userId, role);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return storeAssignUser(projectId, role, { userId, name }, assignedBy);
}
