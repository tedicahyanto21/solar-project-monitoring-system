// Repository layer for Project Master (Database Design SPMS-DOC-06,
// Section 5 -- projects/{projectId}).
//
// FT-8 Part F (migration strategy): reads branch on `isLocalMode` between
// the mock array and Firestore -- the two are never both authoritative at
// once. FT-9A: create/update now have a real Firestore write path too
// (see services/firebase/projectService.js) -- duplicate protection,
// createdAt preservation, and targeted (non-destructive) updates all live
// there, not in this file.
import { isLocalMode } from '../firebase/config';
import * as firebaseProjects from '../firebase/projectService';
import { getOperations } from '../../data/mockOperationalData';
import { ROLES } from '../../constants/roles';
import {
  PROJECT_STATUSES,
  HEALTH_STATUSES,
  CAPACITY_UNITS,
  REGIONS,
  initialProjects,
  createBlankProject,
  duplicateProject,
} from '../../data/mockProjects';

// C-01A: roles with legitimate portfolio-wide visibility -- unchanged from
// the access model established across FT-1..MP#5 (Dashboard/BOD read
// everything; HEAD_PM oversees the whole portfolio). Every OTHER role only
// sees projects they are actually assigned to.
// C-01C R1: SCM joins this list for a DIFFERENT reason than the other
// three roles -- SUPER_ADMIN/HEAD_PM/BOD have genuine oversight authority
// over the whole portfolio; SCM has none of that. SCM is here ONLY
// because Procurement is a global functional role that legitimately needs
// to open any project's Work Structure without a projectAssignments entry
// (confirmed Firebase UAT finding, C-01C R1). This grants SCM nothing
// beyond READ access to the project list/detail -- it does not touch
// Project Master write authorization (ProjectsPage.jsx's
// CAN_MANAGE_PROJECT_ROLES, unchanged) or team/PM assignment
// (TeamTab.jsx's ASSIGNABLE_BY, unchanged), and Procurement's own
// ACTUAL-write authorization is granted separately in firestore.rules,
// not by this list.
const PORTFOLIO_WIDE_ROLES = [ROLES.SUPER_ADMIN, ROLES.HEAD_PM, ROLES.BOD, ROLES.SCM];

function isAssignedInLocalMode(projectId, userId) {
  return getOperations(projectId)?.assignments?.some((a) => a.userId === userId) ?? false;
}

// C-01A Access & Assignment Control: `currentUser` is OPTIONAL and
// preserves the prior, unrestricted behavior when omitted -- this is what
// progressRepository.getPortfolioSummary() (Dashboard aggregation, which
// is intentionally portfolio-wide for every role per the existing
// Dashboard design) continues to rely on unchanged. When ProjectsPage.jsx
// (the Project Master list, the actual UAT-failing surface) supplies
// `currentUser = { userId, role }`, results are scoped: a
// PORTFOLIO_WIDE_ROLES caller still sees everything; anyone else sees only
// projects where they hold a projectAssignments entry, in either backend.
export async function getProjects(currentUser) {
  if (!currentUser || PORTFOLIO_WIDE_ROLES.includes(currentUser.role)) {
    return isLocalMode ? initialProjects : firebaseProjects.getProjects();
  }
  if (isLocalMode) {
    return initialProjects.filter((p) => isAssignedInLocalMode(p.id, currentUser.userId));
  }
  const assignedIds = await firebaseProjects.getProjectIdsAssignedToUser(currentUser.userId);
  if (assignedIds.length === 0) return [];
  return firebaseProjects.getProjectsByIds(assignedIds);
}

// C-01A: same optional-currentUser pattern as getProjects above. This is
// also the DIRECT-URL defense (Section 6 of the C-01A audit): even if a
// user constructs /projects/{someOtherProjectId} directly, this check runs
// independently of whatever the list page would have shown them -- it does
// not rely on the user having gone through a correctly-filtered list
// first. A denied project is returned as `null`, deliberately
// indistinguishable from "does not exist" (Project Detail already has a
// "Project not found" state for null -- reusing it avoids leaking whether
// an unauthorized projectId is valid).
export async function getProjectById(projectId, currentUser) {
  const project = isLocalMode
    ? (initialProjects.find((p) => p.id === projectId) ?? null)
    : await firebaseProjects.getProjectById(projectId);
  if (!project) return null;
  if (!currentUser || PORTFOLIO_WIDE_ROLES.includes(currentUser.role)) return project;
  const isAssigned = isLocalMode
    ? isAssignedInLocalMode(projectId, currentUser.userId)
    : (await firebaseProjects.getProjectIdsAssignedToUser(currentUser.userId)).includes(projectId);
  return isAssigned ? project : null;
}

export async function createProject(formValues) {
  // Section 5: preserve the EXISTING id-generation mechanism
  // (createBlankProject's crypto.randomUUID()) for both modes, rather than
  // inventing a second scheme for Firestore. Only the persistence step
  // forks between LOCAL and FIREBASE mode.
  const projectData = createBlankProject(formValues);
  if (isLocalMode) {
    return projectData;
  }
  return firebaseProjects.createProject(projectData.id, projectData);
}

// Sprint FT-9A: real targeted update. LOCAL MODE has no persistent project
// store separate from ProjectsPage's own React state (creation already
// worked this way since Sprint FT-4) -- this just echoes the patch back so
// the calling page's existing local-state merge behaves identically to
// before; FIREBASE MODE performs the actual targeted Firestore update.
// Master Prompt #4, Finding #1 fix: LOCAL MODE previously only ECHOED the
// patch back (`{ id: projectId, ...patch }`) without actually mutating the
// underlying initialProjects array -- harmless for the original call site
// (ProjectsPage.jsx merges the echo into its own React state), but WRONG
// for any caller that re-reads via getProjectById afterward expecting to
// see the change (as projectDetailRepository.setProjectManager does for
// PM identity sync). Now genuinely persists in-memory, for this session,
// consistent with how mockOperationalData's per-project store mutates.
export async function updateProject(projectId, patch) {
  if (isLocalMode) {
    const project = initialProjects.find((p) => p.id === projectId);
    if (!project) return null;
    Object.assign(project, patch);
    return { ...project };
  }
  return firebaseProjects.updateProject(projectId, patch);
}

export async function duplicateProjectRecord(project) {
  if (!isLocalMode) {
    throw new Error('Project duplication is not yet available in Firestore mode. This is prepared in a future sprint.');
  }
  return duplicateProject(project);
}

// Reference data -- re-exported as-is for now. These become Firestore-backed
// lookups (or remain static config) when the real backend lands.
export { PROJECT_STATUSES, HEALTH_STATUSES, CAPACITY_UNITS, REGIONS };
