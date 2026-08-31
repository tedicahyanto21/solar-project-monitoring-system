// Repository for Project Master detail sub-collections (Database Design
// SPMS-DOC-06, Sections 6, 8-11): assignments, milestones, engineering
// documents, HSE documents, construction activities, commissioning
// checklist.
//
// FT-8/consolidation Part F: every function branches on `isLocalMode` and
// delegates to either the mock store or the Firestore service -- the two
// are never both authoritative at once (see services/firebase/projectDetailService.js).
//
// KNOWN GAP: the generic contractual `milestones` timeline (per-phase
// schedule display, distinct from the granular procurementMilestones) has
// no Firestore-backed equivalent yet -- it is not one of the explicit
// FT-8 Part E collections and remains mock-only. Documented, not hidden.
import { isLocalMode } from '../firebase/config';
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
import * as fb from '../firebase/projectDetailService';
import { validateAssignable } from './userRepository';

export async function getMilestones(projectId) {
  // Mock-only -- see file header KNOWN GAP.
  return getOperations(projectId)?.milestones ?? [];
}

export async function getEngineeringDocuments(projectId) {
  return isLocalMode ? (getOperations(projectId)?.engineeringDocuments ?? []) : fb.getEngineeringDocuments(projectId);
}

export async function createEngineeringDocument(projectId, doc) {
  return isLocalMode ? addEngineeringDocument(projectId, doc) : fb.addEngineeringDocument(projectId, doc);
}

// FT-5 A3: authorized Engineering users maintain progressContribution on an
// EXISTING document over time -- this is the normal way progress is kept
// current, not just document creation.
export async function updateEngineeringDocument(projectId, docId, patch) {
  return isLocalMode ? storeUpdateEngineeringDocument(projectId, docId, patch) : fb.updateEngineeringDocument(projectId, docId, patch);
}

export async function getHseDocuments(projectId) {
  return isLocalMode ? (getOperations(projectId)?.hseDocuments ?? []) : fb.getHseDocuments(projectId);
}

export async function createHseDocument(projectId, doc) {
  return isLocalMode ? addHseDocument(projectId, doc) : fb.addHseDocument(projectId, doc);
}

// FT-5 A4: same principle as Engineering -- authorized HSE users update an
// existing item's progressContribution independently of its status.
export async function updateHseDocument(projectId, docId, patch) {
  return isLocalMode ? storeUpdateHseDocument(projectId, docId, patch) : fb.updateHseDocument(projectId, docId, patch);
}

export async function getProcurementMilestones(projectId) {
  return isLocalMode ? (getOperations(projectId)?.procurementMilestones ?? []) : fb.getProcurementMilestones(projectId);
}

// FT-5 A5: milestones are configurable, not a hardcoded closed list --
// this is how a project adds one beyond the seeded defaults.
export async function createProcurementMilestone(projectId, milestone) {
  return isLocalMode ? storeCreateProcurementMilestone(projectId, milestone) : fb.createProcurementMilestone(projectId, milestone);
}

export async function updateProcurementMilestone(projectId, milestoneId, patch) {
  return isLocalMode ? storeUpdateProcurementMilestone(projectId, milestoneId, patch) : fb.updateProcurementMilestone(projectId, milestoneId, patch);
}

export async function getConstructionActivities(projectId) {
  return isLocalMode ? (getOperations(projectId)?.constructionActivities ?? []) : fb.getConstructionActivities(projectId);
}

// FT-5 A6: throws on negative Actual Quantity or a zero/negative Planned
// Quantity -- the caller (UI) is expected to catch and display this, not
// treat it as a bug. History is appended, never overwritten (both backends).
export async function updateConstructionActivity(projectId, activityId, { actualQuantity, date }) {
  return isLocalMode
    ? storeUpdateConstructionActivity(projectId, activityId, { actualQuantity, date })
    : fb.updateConstructionActivity(projectId, activityId, { actualQuantity, date });
}

export async function getCommissioningChecklist(projectId) {
  return isLocalMode ? (getOperations(projectId)?.commissioningChecklist ?? []) : fb.getCommissioningChecklist(projectId);
}

export async function getAssignments(projectId) {
  return isLocalMode ? (getOperations(projectId)?.assignments ?? []) : fb.getAssignments(projectId);
}

// Assignment authority (Project Blueprint SPMS-DOC-05, Section 5; Sprint
// FT-4 Team Assignment rules) is enforced by the caller (UI checks the
// current user's role before calling this) -- this function performs the
// write, it does not itself authorize it. Real authorization ALSO happens
// in firestore.rules once deployed -- this is not the only enforcement
// layer (FT-7/consolidation Part 6: hiding a button is not security).
//
// FT-4.1 Correction 2: the assignment reference is userId, matching
// projects/{projectId}/assignments/{userId}. `name` is passed alongside
// purely as a denormalized display convenience -- callers must not use
// name as the identity of the assignment.
// FT-7 Part C: assignment eligibility (exists, ACTIVE, correct role) is
// validated HERE -- at the repository boundary -- not just filtered out of
// the UI picker, regardless of which backend is active.
export async function assignUser(projectId, role, { userId, name }, assignedBy) {
  const check = await validateAssignable(userId, role);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return isLocalMode ? storeAssignUser(projectId, role, { userId, name }, assignedBy) : fb.assignUser(projectId, role, { userId, name }, assignedBy);
}
