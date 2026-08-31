// Firestore-backed Issue Management service (Sprint FT-6 Part A; FT-8
// collection architecture). projects/{projectId}/issues/{issueId}.
import { getAllDocs, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS, PROJECT_SUBCOLLECTIONS } from './firestorePaths';

function issuesPath(projectId) {
  return `${COLLECTIONS.PROJECTS}/${projectId}/${PROJECT_SUBCOLLECTIONS.ISSUES}`;
}

export async function getIssues(projectId) {
  return getAllDocs(issuesPath(projectId));
}

export async function createIssue(projectId, issue) {
  const now = new Date().toISOString().slice(0, 10);
  return createDoc(issuesPath(projectId), {
    projectId, status: 'OPEN', createdAt: now, openedAt: now, closedAt: null, closedBy: null,
    responsibleUserId: null, responsibleUserName: '', ...issue,
  });
}

export async function updateIssueRecord(projectId, issueId, patch) {
  return updateDocById(issuesPath(projectId), issueId, patch);
}

// Closing preserves openedAt/createdAt -- only status, closedAt, closedBy change.
export async function closeIssueRecord(projectId, issueId, closedBy) {
  return updateDocById(issuesPath(projectId), issueId, { status: 'CLOSED', closedAt: new Date().toISOString().slice(0, 10), closedBy });
}

// Reopening clears closedAt/closedBy only -- openedAt/createdAt untouched.
export async function reopenIssueRecord(projectId, issueId) {
  return updateDocById(issuesPath(projectId), issueId, { status: 'OPEN', closedAt: null, closedBy: null });
}
