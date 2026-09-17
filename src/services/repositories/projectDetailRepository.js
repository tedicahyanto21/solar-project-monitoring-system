// Repository for Project Master detail sub-collections (Database Design
// SPMS-DOC-06, Sections 6, 8-11): assignments, milestones, engineering
// documents, HSE documents, construction activities, commissioning
// checklist, progress weights, and progress history.
//
// FT-8/consolidation Part F: every function branches on `isLocalMode` and
// delegates to either the mock store or the Firestore service -- the two
// are never both authoritative at once (see services/firebase/projectDetailService.js).
//
// Master Prompt #2: this file is the ONLY place progressRepository (the
// single progress CALCULATION owner) obtains its raw inputs from. It must
// never itself calculate progress -- it only accesses and normalizes
// domain data, per Section 5.3's layer boundary.
//
// KNOWN GAP (unchanged since MP #1): the generic contractual `milestones`
// timeline (per-phase schedule display, distinct from the granular
// procurementMilestones) has no Firestore-backed equivalent -- it is a
// display-only concern, not part of the Progress Engine's canonical PLAN/
// ACTUAL model (MP #2 Section 28 explicitly confirms this is not required
// for progress calculation), and remains mock-only by deliberate scope
// decision, not oversight.
import { isLocalMode } from '../firebase/config';
import {
  getOperations,
  DEFAULT_WEIGHTS,
  addEngineeringDocument,
  updateEngineeringDocument as storeUpdateEngineeringDocument,
  addHseDocument,
  updateHseDocument as storeUpdateHseDocument,
  createProcurementMilestone as storeCreateProcurementMilestone,
  updateProcurementMilestone as storeUpdateProcurementMilestone,
  createConstructionActivity as storeCreateConstructionActivity,
  updateConstructionActivityPlan as storeUpdateConstructionActivityPlan,
  updateConstructionActivity as storeUpdateConstructionActivity,
  assignUser as storeAssignUser,
  setProjectManagerAssignment as storeSetProjectManagerAssignment,
  removeAssignment as storeRemoveAssignment,
  setProgressWeights as storeSetWeights,
  recordProgressSnapshot as storeRecordSnapshot,
} from '../../data/mockOperationalData';
import * as fb from '../firebase/projectDetailService';
import { validateAssignable } from './userRepository';
import { updateProject as updateProjectRecord } from './projectRepository';
import { ROLES } from '../../constants/roles';

export async function getMilestones(projectId) {
  // Mock-only -- see file header KNOWN GAP.
  return getOperations(projectId)?.milestones ?? [];
}

// Master Prompt #2, Section 13: progress component weights. Canonical
// location is the `progressWeights` field on the project document itself
// (Firebase: projectDetailService.getProjectWeights/setProjectWeights,
// following the same project-doc-field pattern already established by
// costService.getPlannedCost/setPlannedCost) -- not a new collection.
// Falls back to DEFAULT_WEIGHTS for a project that has none configured
// yet, in EITHER mode, so progressRepository never has to special-case a
// missing value.
export async function getProjectWeights(projectId) {
  const weights = isLocalMode ? getOperations(projectId)?.progressWeights : await fb.getProjectWeights(projectId);
  return weights ?? { ...DEFAULT_WEIGHTS };
}

// Weight-total validation (exactly 100%) is progressRepository's job, not
// this function's -- this is pure data access/persistence, matching
// Section 5.3's "domain data access... MUST NOT become a second
// calculation/validation engine" boundary. progressRepository.
// setProjectWeights validates BEFORE calling this.
export async function setProjectWeights(projectId, weights) {
  return isLocalMode ? storeSetWeights(projectId, weights) : fb.setProjectWeights(projectId, weights);
}

// Master Prompt #2, Section 14: progressHistory remains the canonical
// historical record in both modes -- no second history collection.
export async function getProgressHistory(projectId) {
  return isLocalMode ? (getOperations(projectId)?.progressHistory ?? []) : fb.getProgressHistory(projectId);
}

export async function recordProgressSnapshot(projectId, snapshot) {
  return isLocalMode ? storeRecordSnapshot(projectId, snapshot) : fb.recordProgressSnapshot(projectId, snapshot);
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

// Master Prompt #3, Section 4: PM PLAN capability. A brand-new activity
// starts at actualQuantity=0/history=[] -- it is immediately visible to
// the Progress Engine (Construction Progress = 0/plannedQuantity = 0%
// until Site Manager records the first actual result).
export async function createConstructionActivity(projectId, activity) {
  return isLocalMode ? storeCreateConstructionActivity(projectId, activity) : fb.createConstructionActivity(projectId, activity);
}

// Master Prompt #3, Section 4: PLAN-only edit. Never touches
// actualQuantity/history, regardless of what the caller passes -- both
// backends only ever read the four named PLAN fields off the patch.
export async function updateConstructionActivityPlan(projectId, activityId, patch) {
  return isLocalMode ? storeUpdateConstructionActivityPlan(projectId, activityId, patch) : fb.updateConstructionActivityPlan(projectId, activityId, patch);
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
// Master Prompt #4, Finding #1: PM identity consistency. This is the ONE
// domain operation for changing who the Project Manager is -- both a
// direct PROJECT_MANAGER assignment (via assignUser below, e.g. from
// TeamTab) and a projectManagerId change from Project Master's Add/Edit
// form (ProjectsPage.jsx) go through this SAME function, so
// project.projectManagerId and the projectAssignments PROJECT_MANAGER
// record can never silently drift apart. The assignment record remains
// authoritative for AUTHORIZATION (Firestore rules' isAssignedToProject
// and hasRole checks read the user's own profile + assignment existence,
// never projectManagerId); projectManagerId is a denormalized convenience
// field on the project master document for display/filtering only.
export async function setProjectManager(projectId, { userId, name }, assignedBy) {
  const check = await validateAssignable(userId, ROLES.PROJECT_MANAGER);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  // MP#4 Corrective Fix, Section 8: in FIREBASE MODE, the assignment write
  // and the project.projectManagerId sync happen as ONE atomic batch (see
  // projectDetailService.setProjectManager) -- not two separate calls that
  // could leave one written and the other not. LOCAL MODE has no
  // equivalent partial-failure window (synchronous in-memory mutation, no
  // network round trip between the two updates), so the existing two-step
  // sequence there is already effectively atomic and is left unchanged.
  if (isLocalMode) {
    const assignments = storeSetProjectManagerAssignment(projectId, { userId, name }, assignedBy);
    await updateProjectRecord(projectId, { projectManagerId: userId, projectManager: name });
    return assignments;
  }
  return fb.setProjectManager(projectId, { userId, name }, assignedBy);
}

export async function assignUser(projectId, role, { userId, name }, assignedBy) {
  if (role === ROLES.PROJECT_MANAGER) {
    return setProjectManager(projectId, { userId, name }, assignedBy);
  }
  const check = await validateAssignable(userId, role);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return isLocalMode ? storeAssignUser(projectId, role, { userId, name }, assignedBy) : fb.assignUser(projectId, role, { userId, name }, assignedBy);
}

// C-01A: removes one specific (role, userId) holder -- the counterpart to
// the additive assignUser above, for multi-holder roles (SITE_MANAGER/
// ENGINEERING/HSE). Deliberately not offered for PROJECT_MANAGER (always
// exactly one; use assignUser/setProjectManager to change who holds it).
export async function removeAssignment(projectId, role, userId) {
  if (role === ROLES.PROJECT_MANAGER) {
    throw new Error('Project Manager cannot be removed directly -- assign a replacement instead.');
  }
  return isLocalMode ? storeRemoveAssignment(projectId, role, userId) : fb.removeAssignment(projectId, role, userId);
}
