// Repository layer for Project Master (Database Design SPMS-DOC-06,
// Section 5 -- projects/{projectId}).
//
// FT-8 Part F (migration strategy): reads branch on `isLocalMode` between
// the mock array and Firestore -- the two are never both authoritative at
// once. Project CREATION is not yet wired to Firestore (a full write path,
// including validation, is a separate implementation sprint); it stays
// mock-only and says so clearly rather than silently doing something
// inconsistent in real-Firebase mode.
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
  if (!isLocalMode) {
    throw new Error('Project creation is not yet available in Firestore mode. This is prepared in a future sprint.');
  }
  return createBlankProject(formValues);
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
