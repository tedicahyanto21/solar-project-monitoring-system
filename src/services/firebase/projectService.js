// Firestore-backed Project service (Sprint FT-8, Parts D/E).
//
// projects/{projectId} shape matches Database Design SPMS-DOC-06, Section 5.
// The Firestore document ID is the projectId.
import { getAllDocs, getOneDoc } from './firestoreHelpers';
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
