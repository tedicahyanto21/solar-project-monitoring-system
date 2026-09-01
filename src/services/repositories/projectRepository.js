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
import {
  PROJECT_STATUSES,
  HEALTH_STATUSES,
  CAPACITY_UNITS,
  REGIONS,
  PROJECT_MANAGERS,
  initialProjects,
  createBlankProject,
  duplicateProject,
} from '../../data/mockProjects';

export async function getProjects() {
  return isLocalMode ? initialProjects : firebaseProjects.getProjects();
}

export async function getProjectById(projectId) {
  return isLocalMode ? (initialProjects.find((p) => p.id === projectId) ?? null) : firebaseProjects.getProjectById(projectId);
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
export async function updateProject(projectId, patch) {
  if (isLocalMode) {
    return { id: projectId, ...patch };
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
export { PROJECT_STATUSES, HEALTH_STATUSES, CAPACITY_UNITS, REGIONS, PROJECT_MANAGERS };
